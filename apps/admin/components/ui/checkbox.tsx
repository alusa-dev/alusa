import type { ChangeEvent, InputHTMLAttributes } from 'react';

export function Checkbox({ className = '', onCheckedChange, onChange, ...props }: InputHTMLAttributes<HTMLInputElement> & { onCheckedChange?: (_checked: boolean) => void }) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange?.(event);
    onCheckedChange?.(event.target.checked);
  }
  return <input type="checkbox" className={`admin-checkbox ${className}`} onChange={handleChange} {...props} />;
}
