import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { DiffResponse } from '../../types';
import { useToast } from '../Toast';
import { colors, radii } from '../../styles/tokens';

interface DiffViewProps {
  pageId: string;
}

export const DiffView: React.FC<DiffViewProps> = ({ pageId }) => {
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.getDiff(pageId);
        setDiff(data);
      } catch (e: any) {
        const msg = e.message || 'Не удалось загрузить diff';
        setError(msg);
        showToast('error', 'Ошибка загрузки изменений', msg);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [pageId]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
        Загрузка изменений...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: colors.statusLost }}>
        {error}
      </div>
    );
  }

  if (!diff || !diff.has_changes) {
    return (
      <div style={{
        padding: '60px 40px',
        textAlign: 'center',
        color: colors.textSecondary,
      }}>
        <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}>✓</div>
        <div style={{ fontSize: '15px' }}>
          Нет изменений между baseline (v{diff?.baseline_version}) и текущим снимком (v{diff?.current_version})
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{
        marginBottom: '16px',
        fontSize: '13px',
        color: colors.textSecondary,
        display: 'flex',
        gap: '16px',
      }}>
        <span>Baseline: v{diff.baseline_version}</span>
        <span>→</span>
        <span>Текущий: v{diff.current_version}</span>
      </div>
      <div style={{
        background: colors.white,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.md,
        padding: '24px',
        fontSize: '14px',
        // Тот же межстрочный интервал, что и у контента (ContentRenderer),
        // чтобы вкладки «Покрытие» и «Изменения» выглядели одинаково.
        lineHeight: '1.45',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        <div dangerouslySetInnerHTML={{ __html: diff.diff_html }} />
      </div>
    </div>
  );
};

export default DiffView;
