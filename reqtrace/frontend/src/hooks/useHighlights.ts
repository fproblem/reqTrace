import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { Highlight } from '../types';

export function useHighlights(pageId: string | undefined) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    try {
      const data = await api.listHighlights(pageId);
      setHighlights(data);
    } catch (e) {
      console.error('Failed to load highlights', e);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  const createHighlight = useCallback(async (data: {
    text_content: string;
    text_before: string;
    text_after: string;
    anchor_block_start: number;
    anchor_block_end: number;
    start_char_offset: number;
    end_char_offset: number;
    user_id: string;
  }) => {
    if (!pageId) return;
    await api.createHighlight(pageId, data);
    await load();
  }, [pageId, load]);

  const deleteHighlight = useCallback(async (highlightId: string) => {
    await api.deleteHighlight(highlightId);
    await load();
  }, [load]);

  const addTest = useCallback(async (highlightId: string, testKey: string, userId: string) => {
    await api.addTestLink(highlightId, testKey, userId);
    await load();
  }, [load]);

  const removeTest = useCallback(async (linkId: string) => {
    await api.removeTestLink(linkId);
    await load();
  }, [load]);

  return {
    highlights,
    loading,
    reload: load,
    createHighlight,
    deleteHighlight,
    addTest,
    removeTest,
  };
}

export default useHighlights;
