import { Modal } from './Modal.tsx';
import { useI18n } from './i18n.tsx';

/**
 * Legal notice / Impressum. The address lines below are placeholders —
 * replace them with the real postal address before publishing.
 */
const IMPRINT = {
  name: 'Thorsten Rinne',
  addressLines: ['[Straße und Hausnummer]', '[PLZ Ort]', 'Deutschland'],
  email: 'thorsten@rinne.info',
  website: 'https://www.rinne.info',
};

export function ImprintPage({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('imprint.title')} onClose={onClose} testId="imprint-page">
      <section>
        <h3>{t('imprint.according')}</h3>
        <p>
          {IMPRINT.name}
          <br />
          {IMPRINT.addressLines.map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
        </p>
      </section>
      <section>
        <h3>{t('imprint.contact')}</h3>
        <p>
          E-Mail: <a href={`mailto:${IMPRINT.email}`}>{IMPRINT.email}</a>
          <br />
          Web:{' '}
          <a href={IMPRINT.website} target="_blank" rel="noreferrer">
            {IMPRINT.website}
          </a>
        </p>
      </section>
      <section>
        <h3>{t('imprint.responsible')}</h3>
        <p>{IMPRINT.name}</p>
      </section>
      <section>
        <h3>{t('imprint.disclaimer.title')}</h3>
        <p>{t('imprint.disclaimer.body')}</p>
      </section>
    </Modal>
  );
}
