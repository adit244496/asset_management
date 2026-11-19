import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { ASSET, PERIPHERAL, REGISTER_KEYS, isRegisterKey, pathOf, registerOf } from '../lib/registers';
import { REGISTER_TOPICS, topicOfRegister, useLiveEvent } from '../lib/live';
import { COLUMNS, byKey } from '../lib/schema';
import { useAuth } from './AuthContext';
import { useMasters } from './MastersContext';

const AssetsContext = createContext(null);

function normalizeAsset(raw) {
  const rec = {};
  COLUMNS.forEach((col) => {
    const v = raw?.[col.key];
    rec[col.key] = v === undefined || v === null ? '' : (typeof v === 'string' ? v.trim() : v);
  });
  rec.id = raw?.id;
  [
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'isDeleted', 'register',
    'linkedPeripherals', 'linkedAssets', 'previousStatus',
    'verification', 'verifiedBy', 'verifiedAt', 'verificationNote',
    'srlMasked',
    'expired',
    'lifecycle',
    'pendingApproval',
  ].forEach((k) => {
    if (raw?.[k] !== undefined) rec[k] = raw[k];
  });
  return rec;
}

const REGISTER_STORAGE_KEY = 'am.register';

function storedRegister() {
  try {
    const saved = window.localStorage.getItem(REGISTER_STORAGE_KEY);
    return isRegisterKey(saved) ? saved : ASSET;
  } catch {
    return ASSET;
  }
}

const emptyRows = () => Object.fromEntries(REGISTER_KEYS.map((k) => [k, null]));

const NOT_LOADED = Object.freeze([]);

export function AssetsProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const { isMastered, namesFor, reload: reloadMasters } = useMasters();
  const [register, setRegisterState] = useState(storedRegister);
  const [rows, setRows] = useState(emptyRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const assets = rows[register] || NOT_LOADED;

  const setRegister = useCallback((key) => {
    const next = isRegisterKey(key) ? key : ASSET;
    setRegisterState(next);
    try {
      window.localStorage.setItem(REGISTER_STORAGE_KEY, next);
    } catch { }
  }, []);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(`/${pathOf(register)}`);
      const items = (res.data?.items || []).map(normalizeAsset);
      setRows((prev) => ({ ...prev, [register]: items }));
      setError(null);
    } catch (err) {
      if (!quiet) setError(err);
      throw err;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [register]);

  // Someone changed a register: re-fetch the one on screen quietly (no
  // "Loading"), and forget the others so they load fresh when opened.
  useLiveEvent(REGISTER_TOPICS, (changed) => {
    if (!isAuthenticated) return;
    const keys = REGISTER_KEYS.filter((k) => changed.includes(topicOfRegister(k)));
    const others = keys.filter((k) => k !== register);
    if (others.length) {
      setRows((prev) => (others.some((k) => prev[k] !== null)
        ? { ...prev, ...Object.fromEntries(others.map((k) => [k, null])) } : prev));
    }
    if (keys.includes(register) && rows[register] !== null) {
      refresh({ quiet: true }).catch(() => { });
    }
  });

  const invalidateAll = useCallback(() => {
    setRows(emptyRows());
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setRows((prev) => (REGISTER_KEYS.some((k) => prev[k] !== null) ? emptyRows() : prev));
      setError((prev) => (prev ? null : prev));
      return;
    }
    if (rows[register] !== null) return;
    refresh().catch(() => { });
  }, [isAuthenticated, register, rows, refresh]);

  const syncMasters = useCallback(() => {
    reloadMasters().catch(() => { });
  }, [reloadMasters]);

  const base = `/${pathOf(register)}`;

  const forgetLinkedPeripherals = useCallback((values) => {
    if (register !== PERIPHERAL && Array.isArray(values?.linkedPeripheralIds)) {
      setRows((prev) => (prev[PERIPHERAL] === null ? prev : { ...prev, [PERIPHERAL]: null }));
    }
  }, [register]);

  const createAsset = useCallback(async (values) => {
    const res = await api.post(base, values);
    forgetLinkedPeripherals(values);
    await refresh();
    syncMasters();
    return normalizeAsset(res.data);
  }, [base, refresh, syncMasters, forgetLinkedPeripherals]);

  const updateAsset = useCallback(async (id, values) => {
    const res = await api.patch(`${base}/${encodeURIComponent(id)}`, values);
    forgetLinkedPeripherals(values);
    await refresh();
    syncMasters();
    const saved = normalizeAsset(res.data);
    if (res.data?.approvalRequested) saved.approvalRequested = res.data.approvalRequested;
    // Sold now: what happened to its linked peripherals (to stock / scrapped).
    if (res.data?.linkedReleased) saved.linkedReleased = res.data.linkedReleased;
    return saved;
  }, [base, refresh, syncMasters, forgetLinkedPeripherals]);

  const updateAssets = useCallback(async (ids, changes) => {
    const res = await api.patch(`${base}/bulk`, { ids, changes });
    await refresh();
    syncMasters();
    return res.data;
  }, [base, refresh, syncMasters]);

  const deleteAsset = useCallback(async (id) => {
    await api.delete(`${base}/${encodeURIComponent(id)}`);
    await refresh();
  }, [base, refresh]);

  const purgeAsset = useCallback(async (id, password) => {
    const res = await api.delete(`${base}/${encodeURIComponent(id)}/permanent`,
      { data: { password } });
    await refresh();
    return res.data;
  }, [base, refresh]);

  // scrapLinked (assets): scrap their linked peripherals too, instead of sending them to stock;
  // scrapShared: including shared ones still on other assets (taken off all of them).
  const deleteAssets = useCallback(async (ids, reason = '', { scrapLinked = false, scrapShared = false } = {}) => {
    const res = await api.post(`${base}/bulk-delete`, {
      ids, reason, ...(scrapLinked ? { scrapLinked: true } : {}), ...(scrapLinked && scrapShared ? { scrapShared: true } : {}),
    });
    await refresh();
    return res.data;
  }, [base, refresh]);

  const restoreAsset = useCallback(async (id, status) => {
    const res = await api.post(`${base}/${encodeURIComponent(id)}/restore`,
      status ? { status } : {});
    await refresh();
    syncMasters();
    return normalizeAsset(res.data);
  }, [base, refresh, syncMasters]);

  const assetHistory = useCallback(async (id, reg = register) => {
    const res = await api.get(`/${pathOf(reg)}/${encodeURIComponent(id)}/history`);
    return res.data;
  }, [register]);

  const fetchRecord = useCallback(async (id, reg = register) => {
    const res = await api.get(`/${pathOf(reg)}/${encodeURIComponent(id)}`);
    return normalizeAsset(res.data);
  }, [register]);

  const lookupAsset = useCallback(async (q) => {
    const res = await api.get('/assets/lookup', { params: { q } });
    return res.data;
  }, []);

  const assetQrCodes = useCallback(async (ids) => {
    const res = await api.post(`${base}/qr`, { ids });
    return res.data;
  }, [base]);

  const registerHistory = useCallback(async (params = {}) => {
    const res = await api.get(`${base}/history`, { params, paramsSerializer: { indexes: null } });
    return res.data;
  }, [base]);

  const clearAllAssets = useCallback(async (password) => {
    await api.delete(base, { data: { password } });
    await refresh();
  }, [base, refresh]);

  const bulkImport = useCallback(async (
    rowsToImport, dedupeKey, createUsers = false, unknownMasters = 'include', typeCodes = null,
  ) => {
    const res = await api.post(`${base}/bulk`, {
      rows: rowsToImport,
      dedupeKey: dedupeKey || null,
      createUsers: Boolean(createUsers),
      unknownMasters,
      // Abbreviations picked for the new types (shown before importing).
      ...(typeCodes && Object.keys(typeCodes).length ? { typeCodes } : {}),
    });
    await refresh();
    syncMasters();
    return res.data;
  }, [base, refresh, syncMasters]);

  const optionsFor = useCallback((key) => {
    const col = byKey(key);
    const seen = new Set();
    const out = [];
    const push = (v) => {
      const clean = (v ?? '').toString().trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      out.push(clean);
    };
    if (isMastered(key, register)) {
      namesFor(key, register).forEach(push);
    } else {
      (col?.options || []).forEach(push);
    }
    assets.forEach((r) => push(r[key]));
    return out;
  }, [assets, isMastered, namesFor, register]);

  const filterOptionsFor = useCallback((key, selected = []) => {
    const present = new Set();
    assets.forEach((row) => {
      const clean = (row[key] ?? '').toString().trim().toLowerCase();
      if (clean) present.add(clean);
    });
    (selected || []).forEach((v) => {
      const clean = (v ?? '').toString().trim().toLowerCase();
      if (clean) present.add(clean);
    });

    const out = optionsFor(key).filter((v) => present.has(v.toLowerCase()));
    const shown = new Set(out.map((v) => v.toLowerCase()));
    (selected || []).forEach((v) => {
      const clean = (v ?? '').toString().trim();
      if (clean && !shown.has(clean.toLowerCase())) {
        shown.add(clean.toLowerCase());
        out.push(clean);
      }
    });
    return out;
  }, [assets, optionsFor]);

  const formOptionsFor = useCallback((key, currentValue) => {
    if (!isMastered(key, register)) return optionsFor(key);
    const seen = new Set();
    const out = [];
    const push = (v) => {
      const clean = (v ?? '').toString().trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      out.push(clean);
    };
    namesFor(key, register).forEach(push);
    push(currentValue);
    return out;
  }, [isMastered, namesFor, optionsFor, register]);

  const value = useMemo(() => ({
    register,
    setRegister,
    meta: registerOf(register),
    assets,
    count: assets.length,
    loading,
    error,
    refresh,
    invalidateAll,
    createAsset,
    updateAsset,
    updateAssets,
    deleteAsset,
    deleteAssets,
    purgeAsset,
    restoreAsset,
    assetHistory,
    fetchRecord,
    registerHistory,
    lookupAsset,
    assetQrCodes,
    clearAllAssets,
    bulkImport,
    optionsFor,
    filterOptionsFor,
    formOptionsFor,
  }), [register, setRegister, assets, loading, error, refresh, invalidateAll, createAsset, updateAsset,
    updateAssets, deleteAsset, deleteAssets, purgeAsset, restoreAsset, assetHistory, fetchRecord,
    registerHistory, lookupAsset, assetQrCodes, clearAllAssets, bulkImport, optionsFor,
    filterOptionsFor, formOptionsFor]);

  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

export function useAssets() {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error('useAssets must be used inside an AssetsProvider');
  return ctx;
}
