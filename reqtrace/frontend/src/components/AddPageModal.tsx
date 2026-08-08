// Модалка «Добавить страницу» (v1.8.1) — переехала из PageTree в Layout:
// добавление — редкое действие настройки, а не ежедневной навигации, и его
// входы теперь живут вне шапки дерева (меню карточки проекта в профиле,
// пустой экран «/», пустое дерево). Все они шлют одно событие
// reqtrace:open-add-page, слушает его Layout — он смонтирован всегда, в
// отличие от PageTree, который сворачивается в рельсу (раньше клик по CTA
// на «/» при свёрнутом дереве молча пропадал — слушать было некому).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Project } from '../types';
import { colors, radii, shadows } from '../styles/tokens';
import { Modal, ModalButton, modalTextStyle } from './Modal';
import { Select } from './Select';
import { useToast } from './Toast';
import { useTreeRefresh } from '../hooks/useTreeRefresh';
import { urlBelongsToBase } from '../utils/baseUrl';

export const AddPageModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open, onClose,
}) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { refreshTree } = useTreeRefresh();
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  // Список проектов с base URL — для выбора проекта при добавлении страницы.
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  // Проекты с кредами подтягиваются при открытии формы.
  useEffect(() => {
    if (!open) return;
    setNewUrl('');
    setError('');
    api.listProjects()
      .then(setMyProjects)
      .catch(() => setMyProjects([]));
  }, [open]);

  // Проекты текущего пользователя, которым подходит введённая ссылка.
  const candidateProjects = useMemo(() => {
    const url = newUrl.trim();
    if (!url) return [];
    return myProjects.filter(
      p => p.joined && p.my_status === 'ok' && urlBelongsToBase(url, p.confluence_base_url)
    );
  }, [newUrl, myProjects]);

  useEffect(() => {
    if (candidateProjects.length > 0 && !candidateProjects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId(candidateProjects[0].id);
    }
  }, [candidateProjects, selectedProjectId]);

  const handleAddPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAdding(true);
    setError('');
    try {
      const projectId = candidateProjects.length > 1 ? selectedProjectId : undefined;
      const page = await api.addPage(newUrl.trim(), projectId);
      onClose();
      // Дерево перечитается и само (loadTree по смене маршрута), refreshTree —
      // страховка на случай навигации в уже открытый путь.
      refreshTree();
      navigate(`/pages/${page.id}`);
    } catch (e: any) {
      const msg = e.message || 'Ошибка при добавлении';
      setError(msg);
      showToast('error', 'Не удалось добавить страницу', msg);
    } finally {
      setAdding(false);
    }
  };

  if (!open) return null;

  return (
    <Modal title="Добавить страницу" onClose={onClose} width="460px">
      <form onSubmit={handleAddPage}>
        <p style={modalTextStyle}>
          Вставьте ссылку на страницу Confluence — она добавится в дерево
          вместе со структурой своего раздела.
        </p>
        <input
          type="text"
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="https://confluence…/pages/viewpage.action?pageId=…"
          autoFocus
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: radii.md,
            border: `1px solid ${colors.border}`,
            fontSize: '13px',
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = colors.focusBorder;
            e.currentTarget.style.boxShadow = shadows.focusRing;
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {/* Ссылка подходит нескольким проектам (общий сервер) — явный выбор */}
        {candidateProjects.length > 1 && (
          <Select
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            size="sm"
            title="Проект, в который добавить страницу"
            style={{ marginTop: '10px', width: '100%' }}
            options={candidateProjects.map(p => ({
              value: p.id,
              label: `В проект: ${p.name}`,
            }))}
          />
        )}
        {error && (
          <div style={{ color: colors.statusLost, fontSize: '12px', marginTop: '10px' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
          <ModalButton type="button" onClick={onClose}>
            Отмена
          </ModalButton>
          <ModalButton type="submit" variant="primary" disabled={!newUrl.trim() || adding}>
            {adding ? 'Добавляем…' : 'Добавить'}
          </ModalButton>
        </div>
      </form>
    </Modal>
  );
};
