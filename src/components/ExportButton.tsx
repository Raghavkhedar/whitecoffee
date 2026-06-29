'use client';
import Icon from './Icon';

export default function ExportButton({
  onClick, disabled, label = 'Download Excel',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="btn-outline text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
    >
      <Icon name="download" size={14} />{label}
    </button>
  );
}
