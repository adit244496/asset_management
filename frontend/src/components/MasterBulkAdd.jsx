import { useMemo, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import {
  ACCEPTED_EXTENSIONS,
  buildColumns,
  entriesFromRows,
  guessDescriptionIndex,
  guessValueIndex,
  looksLikeHeaderRow,
  readSheetMatrix,
} from '../lib/masterFile';
import { classifyMasterEntries, parseMasterPaste } from '../lib/parseMasterPaste';
import { byKey } from '../lib/schema';
import './MasterBulkAdd.css';

const PREVIEW_LIMIT = 12;

const STATE_LABEL = {
  new: 'will be added',
  exists: 'skipped',
  duplicate: 'skipped',
  invalid: 'skipped',
};

const MasterBulkAdd = ({ category, label, plural, existingNames, onClose, onDone }) => {
  const [mode, setMode] = useState('file');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [valueIndex, setValueIndex] = useState(-1);
  const [descriptionIndex, setDescriptionIndex] = useState(-1);

  const valueCandidates = useMemo(() => {
    const col = byKey(category);
    return [...(col?.headerAliases || []), col?.label, label, plural].filter(Boolean);
  }, [category, label, plural]);

  const { headers, dataRows } = useMemo(
    () => (sheet ? buildColumns(sheet.matrix, hasHeader) : { headers: [], dataRows: [] }),
    [sheet, hasHeader],
  );

  const extracted = useMemo(
    () => (sheet && valueIndex >= 0
      ? entriesFromRows(dataRows, valueIndex, descriptionIndex)
      : { entries: [], scanned: 0, distinct: 0 }),
    [sheet, dataRows, valueIndex, descriptionIndex],
  );

  const preview = useMemo(
    () => (mode === 'file'
      ? classifyMasterEntries(extracted.entries, existingNames)
      : parseMasterPaste(text, existingNames)),
    [mode, extracted.entries, text, existingNames],
  );

  const skippedCount = preview.existsCount + preview.duplicateCount + preview.invalidCount;

  const handleFile = async (file) => {
    if (!file) return;
    if (!ACCEPTED_EXTENSIONS.test(file.name)) {
      setError('Unsupported file type. Please upload .xlsx, .xls, or .csv.');
      return;
    }
    setError('');
    setFileName(file.name);
    try {
      const result = await readSheetMatrix(file);
      if (!result.matrix.length) {
        setError(`${file.name} has no rows in its first sheet.`);
        setSheet(null);
        return;
      }
      const detectedHeader = looksLikeHeaderRow(result.matrix[0], valueCandidates);
      const { headers: cols } = buildColumns(result.matrix, detectedHeader);
      const guessedValue = guessValueIndex(cols, valueCandidates);

      setSheet(result);
      setHasHeader(detectedHeader);
      setValueIndex(guessedValue);
      setDescriptionIndex(guessDescriptionIndex(cols, guessedValue));
    } catch (err) {
      setError(`Could not read this file: ${err.message}`);
      setSheet(null);
    }
  };

  const handleAdd = async () => {
    const items = preview.rows
      .filter((r) => r.state === 'new')
      .map((r) => ({ name: r.name, description: r.description }));
    if (!items.length) return;

    setSaving(true);
    setError('');
    try {
      const res = await api.post(`/masters/${encodeURIComponent(category)}/bulk`, { items });
      const added = res.data?.added ?? 0;
      const serverSkipped = res.data?.skipped ?? 0;
      const note = serverSkipped ? `, ${serverSkipped} skipped by the server` : '';
      onDone(`Added ${added.toLocaleString('en-IN')} ${added === 1 ? label.toLowerCase() : plural.toLowerCase()}${note}.`);
    } catch (err) {
      setError(errorMessage(err, `Could not add these ${plural.toLowerCase()}.`));
    } finally {
      setSaving(false);
    }
  };

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setError('');
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>Bulk add {plural}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="bulk-mode-switch" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'file'}
              className={`bulk-mode-btn${mode === 'file' ? ' active' : ''}`}
              onClick={() => switchMode('file')}
            >
              Upload a file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'paste'}
              className={`bulk-mode-btn${mode === 'paste' ? ' active' : ''}`}
              onClick={() => switchMode('paste')}
            >
              Paste values
            </button>
          </div>

          {mode === 'file' ? (
            <>
              <div
                className={`drop-zone${dragOver ? ' dragover' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
              >
                <UploadCloud size={24} className="drop-icon" />
                <div><strong>Click to browse</strong> or drag a file here</div>
                <div className="drop-hint">
                  .xlsx, .xls, .csv &mdash; a list of {plural.toLowerCase()}, or any
                  register to take the distinct values from one column
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              {sheet && (
                <div className="bulk-file-config">
                  <div className="bulk-file-name">
                    {fileName} &middot; sheet &ldquo;{sheet.sheetName}&rdquo; &middot;{' '}
                    {extracted.distinct.toLocaleString('en-IN')} distinct value(s)
                    {extracted.scanned !== extracted.distinct
                      && ` from ${extracted.scanned.toLocaleString('en-IN')} rows`}
                  </div>

                  <label className="bulk-file-check">
                    <input
                      type="checkbox"
                      checked={hasHeader}
                      onChange={(e) => {
                        const next = e.target.checked;
                        const { headers: cols } = buildColumns(sheet.matrix, next);
                        const guessed = guessValueIndex(cols, valueCandidates);
                        setHasHeader(next);
                        setValueIndex(guessed);
                        setDescriptionIndex(guessDescriptionIndex(cols, guessed));
                      }}
                    />
                    First row is a header
                  </label>

                  <div className="bulk-file-selects">
                    <div className="field">
                      <label htmlFor="bulkValueCol">{label} column</label>
                      <select
                        id="bulkValueCol"
                        className="field-input"
                        value={valueIndex}
                        onChange={(e) => setValueIndex(Number(e.target.value))}
                      >
                        {headers.map((h) => (
                          <option key={h.index} value={h.index}>{h.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="bulkDescCol">Description column (optional)</label>
                      <select
                        id="bulkDescCol"
                        className="field-input"
                        value={descriptionIndex}
                        onChange={(e) => setDescriptionIndex(Number(e.target.value))}
                      >
                        <option value={-1}>&mdash; none &mdash;</option>
                        {headers.filter((h) => h.index !== valueIndex).map((h) => (
                          <option key={h.index} value={h.index}>{h.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="field">
              <label htmlFor="masterBulkText">One {label.toLowerCase()} per line</label>
              <textarea
                id="masterBulkText"
                className="field-input bulk-add-text"
                rows={9}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="field-hint">
                Paste a column straight from Excel. A second column (tab-separated)
                becomes the description.
              </div>
            </div>
          )}

          {preview.total > 0 && (
            <div className="bulk-add-preview">
              <div className="bulk-add-counts">
                <span className="bulk-count bulk-count-new">
                  {preview.newCount.toLocaleString('en-IN')} to add
                </span>
                {preview.existsCount > 0 && (
                  <span className="bulk-count">
                    {preview.existsCount.toLocaleString('en-IN')} already exist
                  </span>
                )}
                {preview.duplicateCount > 0 && (
                  <span className="bulk-count">
                    {preview.duplicateCount.toLocaleString('en-IN')} repeated
                  </span>
                )}
                {preview.invalidCount > 0 && (
                  <span className="bulk-count bulk-count-bad">
                    {preview.invalidCount.toLocaleString('en-IN')} too long
                  </span>
                )}
              </div>

              <table className="bulk-add-table">
                <thead>
                  <tr>
                    <th>{label}</th>
                    <th>Description</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, PREVIEW_LIMIT).map((r, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <tr key={`${r.name}-${i}`} className={r.state === 'new' ? undefined : 'row-skipped'}>
                      <td>{r.name}</td>
                      <td className="bulk-add-desc">{r.description}</td>
                      <td>{r.reason || STATE_LABEL[r.state]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.total > PREVIEW_LIMIT && (
                <div className="bulk-add-more">
                  &hellip;and {(preview.total - PREVIEW_LIMIT).toLocaleString('en-IN')} more value(s).
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleAdd}
            disabled={saving || preview.newCount === 0}
          >
            {saving
              ? 'Adding…'
              : preview.newCount === 0
                ? 'Nothing to add'
                : `Add ${preview.newCount.toLocaleString('en-IN')}${skippedCount ? ` (skip ${skippedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MasterBulkAdd;
