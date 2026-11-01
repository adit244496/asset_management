import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

const MastersContext = createContext(null);

export function MastersProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const res = await api.get('/masters');
      setCategories(res.data?.categories || []);
      setItems(res.data?.items || {});
      setLoaded(true);
      setError(null);
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoaded((prev) => (prev ? false : prev));
      setItems((prev) => (Object.keys(prev).length ? {} : prev));
      setError((prev) => (prev ? null : prev));
      return;
    }
    reload().catch(() => {  });
  }, [isAuthenticated, reload]);

  const listKey = useCallback((key, registerKey) => {
    const own = categories.filter((c) => (c.field || c.key) === key);
    const hit = own.find((c) => c.classification && c.classification === registerKey)
      || own.find((c) => !c.classification);
    return hit ? hit.key : key;
  }, [categories]);

  const categoriesFor = useCallback(
    (registerKey) => categories.filter((c) => !c.classification || c.classification === registerKey),
    [categories],
  );

  const isMastered = useCallback(
    (key, registerKey) => loaded && Array.isArray(items[listKey(key, registerKey)]),
    [loaded, items, listKey],
  );

  const namesFor = useCallback(
    (key, registerKey) => (items[listKey(key, registerKey)] || []).map((row) => row.name),
    [items, listKey],
  );

  const value = useMemo(() => ({
    categories,
    categoriesFor,
    items,
    loaded,
    error,
    reload,
    isMastered,
    namesFor,
  }), [categories, categoriesFor, items, loaded, error, reload, isMastered, namesFor]);

  return <MastersContext.Provider value={value}>{children}</MastersContext.Provider>;
}

export function useMasters() {
  const ctx = useContext(MastersContext);
  if (!ctx) throw new Error('useMasters must be used inside a MastersProvider');
  return ctx;
}
