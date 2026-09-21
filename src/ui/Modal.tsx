import type { ReactNode } from 'react';
import { useI18n } from './i18n.tsx';

export function Modal({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-close"
            title={t('modal.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
