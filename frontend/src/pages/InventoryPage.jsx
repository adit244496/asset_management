import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import api, { errorMessage } from '../api';
import Banner from '../components/Banner';
import SearchBox from '../components/SearchBox';
import { formatIfDate } from '../lib/dates';
import { countByType, filterStock, inStockOnly } from '../lib/inventory';
import { NOT_RECORDED, isNotRecorded } from '../lib/notRecorded';
import { ASSET, PERIPHERAL, SOFTWARE, registerOf } from '../lib/registers';
import './InventoryPage.css';

const InventoryPage = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [banner, setBanner] = useState(null);
  const [search, setSearch] = useState('');
  const [register, setRegister] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([api.get('/assets'), api.get('/peripherals'), api.get('/softwares')])
      .then(([assets, peripherals, softwares]) => {
        if (!live) return;
        setRows([
          ...inStockOnly(assets.data?.items).map((r) => ({ ...r, register: ASSET })),
          ...inStockOnly(peripherals.data?.items).map((r) => ({ ...r, register: PERIPHERAL })),
          ...inStockOnly(softwares.data?.items).map((r) => ({
            ...r,
            register: SOFTWARE,
            type: 'SOFTWARE',
            model: [r.assetTag, r.version].filter(Boolean).join(' '),
          })),
        ]);
      })
      .catch((err) => {
        if (!live) return;
        setRows([]);
        setBanner({ text: errorMessage(err, 'Could not load the inventory.'), kind: 'error' });
      });
    return () => { live = false; };
  }, []);

  const all = useMemo(() => rows || [], [rows]);

  const inRegister = useMemo(
    () => (register ? all.filter((r) => r.register === register) : all),
    [all, register],
  );
  const types = useMemo(() => countByType(inRegister), [inRegister]);

  const shown = useMemo(() => {
    const byType = type ? inRegister.filter((r) => (r.type || '') === type) : inRegister;
    return filterStock(byType, search);
  }, [inRegister, type, search]);

  const assetCount = all.filter((r) => r.register === ASSET).length;
  const peripheralCount = all.filter((r) => r.register === PERIPHERAL).length;
  const softwareCount = all.filter((r) => r.register === SOFTWARE).length;
  const narrowed = shown.length !== all.length;

  const chooseRegister = (key) => { setRegister(key); setType(''); };

  const cell = (v) => (isNotRecorded(v)
    ? <span className="cell-empty">{NOT_RECORDED}</span> : formatIfDate(v));

  return (
    <div className="page-scroll">
      <div className="page-card">
        <div className="page-header">
          <h1>Inventory</h1>
        </div>

        <Banner banner={banner} onDismiss={() => setBanner(null)} />

        {rows === null ? (
          <div className="panel">Loading inventory&hellip;</div>
        ) : (
          <>
            <div className="inv-summary">
            <button
              type="button"
              className={`inv-chip inv-chip-total${register === '' ? ' active' : ''}`}
              onClick={() => chooseRegister('')}
            >
              <span className="inv-chip-count">{all.length}</span>
              <span className="inv-chip-label">in stock</span>
            </button>
            <button
              type="button"
              className={`inv-chip${register === ASSET ? ' active' : ''}`}
              onClick={() => chooseRegister(ASSET)}
            >
              <span className="inv-chip-count">{assetCount}</span>
              <span className="inv-chip-label">{registerOf(ASSET).label}</span>
            </button>
            <button
              type="button"
              className={`inv-chip${register === PERIPHERAL ? ' active' : ''}`}
              onClick={() => chooseRegister(PERIPHERAL)}
            >
              <span className="inv-chip-count">{peripheralCount}</span>
              <span className="inv-chip-label">{registerOf(PERIPHERAL).label}</span>
            </button>
            <button
              type="button"
              className={`inv-chip${register === SOFTWARE ? ' active' : ''}`}
              onClick={() => chooseRegister(SOFTWARE)}
            >
              <span className="inv-chip-count">{softwareCount}</span>
              <span className="inv-chip-label">{registerOf(SOFTWARE).label}</span>
            </button>
          </div>

          {types.length > 0 && (
            <div className="inv-types">
              {types.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  className={`inv-type${t.type === type ? ' active' : ''}`}
                  onClick={() => setType(t.type === type ? '' : t.type)}
                  aria-pressed={t.type === type}
                >
                  {t.type}
                  <span className="inv-type-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="inv-toolbar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search by ID, serial, model or location&hellip;"
              label="Search the inventory"
            />
            <span className="inv-meta">
              {narrowed
                ? `${shown.length.toLocaleString('en-IN')} of ${all.length.toLocaleString('en-IN')} shown`
                : `${all.length.toLocaleString('en-IN')} item(s)`}
            </span>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Register</th>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Model</th>
                  <th>Serial</th>
                  <th>Location</th>
                  <th>Company</th>
                </tr>
              </thead>
              <tbody>
                {all.length === 0 && (
                  <tr>
                    <td className="table-empty" colSpan={7}>
                      <Package size={20} />
                      <p>
                        Nothing is marked IN STOCK. Everything in both registers is
                        either in use or has left them.
                      </p>
                    </td>
                  </tr>
                )}
                {all.length > 0 && shown.length === 0 && (
                  <tr>
                    <td className="table-empty" colSpan={7}>
                      Nothing in stock matches that.{' '}
                      <button
                        type="button"
                        className="users-empty-clear"
                        onClick={() => { setSearch(''); setType(''); setRegister(''); }}
                      >
                        Clear the filters
                      </button>
                    </td>
                  </tr>
                )}
                {shown.map((row) => (
                  <tr
                    key={`${row.register}-${row.id}`}
                    className="inv-row"
                    onClick={() => navigate(`/report/${row.register}/${encodeURIComponent(row.id)}`)}
                    title="Open this record"
                  >
                    <td>
                      <span className={`inv-tag inv-tag-${row.register}`}>
                        {registerOf(row.register).one}
                      </span>
                    </td>
                    <td className="inv-id">{row.assetId}</td>
                    <td>{cell(row.type)}</td>
                    <td>{cell(row.model)}</td>
                    <td>{cell(row.srl)}</td>
                    <td>{cell(row.location)}</td>
                    <td>{cell(row.company)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
    </div>
  );
};

export default InventoryPage;
