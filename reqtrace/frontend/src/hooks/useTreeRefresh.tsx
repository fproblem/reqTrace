import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

/** Сигнал «дерево страниц устарело» между экранами и сайдбаром.
 *
 * Дерево (PageTree) живёт в Layout и само перезагружается только при смене
 * маршрута. Действия на экране настроек — подключение/отключение проекта,
 * смена кред, удаление — меняют состав дерева без навигации, поэтому экрану
 * нужен способ явно попросить перезагрузку: refreshTree() увеличивает version,
 * а PageTree держит version в deps эффекта загрузки.
 */
interface TreeRefreshContextValue {
  version: number;
  refreshTree: () => void;
}

const TreeRefreshContext = createContext<TreeRefreshContextValue | null>(null);

export const useTreeRefresh = (): TreeRefreshContextValue => {
  const ctx = useContext(TreeRefreshContext);
  if (!ctx) throw new Error('useTreeRefresh must be used within TreeRefreshProvider');
  return ctx;
};

export const TreeRefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [version, setVersion] = useState(0);
  const refreshTree = useCallback(() => setVersion(v => v + 1), []);
  const value = useMemo(() => ({ version, refreshTree }), [version, refreshTree]);
  return <TreeRefreshContext.Provider value={value}>{children}</TreeRefreshContext.Provider>;
};
