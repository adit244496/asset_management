import { Keyboard, Laptop, Package } from 'lucide-react';
import { REGISTER_LIST } from '../lib/registers';
import { useAssets } from '../context/AssetsContext';
import './RegisterToggle.css';

const ICONS = { asset: Laptop, peripheral: Keyboard, software: Package };

const RegisterToggle = ({ size = 'md' }) => {
  const { register, setRegister, loading } = useAssets();

  return (
    <fieldset className={`reg-toggle reg-toggle-${size}`} disabled={loading}>
      <legend className="sr-only">Which register to show</legend>
      {REGISTER_LIST.map((reg) => {
        const Icon = ICONS[reg.key];
        const active = reg.key === register;
        return (
          <label key={reg.key} className={`reg-option${active ? ' active' : ''}`}>
            <input
              type="radio"
              name="register"
              value={reg.key}
              checked={active}
              onChange={() => setRegister(reg.key)}
            />
            {Icon && <Icon size={14} aria-hidden="true" />}
            <span>{reg.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
};

export default RegisterToggle;
