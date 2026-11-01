import { Search, X } from 'lucide-react';
import './SearchBox.css';

const SearchBox = ({ value, onChange, placeholder, label }) => (
  <div className="search-box">
    <Search size={14} className="search-box-icon" />
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label || placeholder}
    />
    {value && (
      <button
        type="button"
        className="search-box-clear"
        onClick={() => onChange('')}
        title="Clear search"
        aria-label="Clear search"
      >
        <X size={13} />
      </button>
    )}
  </div>
);

export default SearchBox;
