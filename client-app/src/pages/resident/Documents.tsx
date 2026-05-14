import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatDate, t, useLocale } from '../../lib/i18n';
import { openUploadedFile } from '../../lib/uploads';
import { DOCUMENT_CATEGORIES, documentCategoryLabel } from '../board/BoardDocuments';
import type { BuildingDocument } from '../board/BoardDocuments';

export default function Documents() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [rows, setRows] = useState<BuildingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');

  useEffect(() => {
    apiGet<BuildingDocument[]>('/documents')
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => rows.filter((doc) => category === 'all' || doc.category === category),
    [rows, category],
  );

  return (
    <>
      <PageHeader
        title={tr('Documentos')}
        subtitle={tr('Regras, atas, contratos, seguros, garantias e avisos importantes publicados pela administração.')}
      />

      <div className="flex flex-wrap gap-2 mb-4" role="list" aria-label={tr('Filtros de documentos')}>
        <button
          type="button"
          onClick={() => setCategory('all')}
          className={`chip ${category === 'all' ? '!bg-dusk-400 !text-cream-50' : ''}`}
        >
          {tr('Todos')}
        </button>
        {DOCUMENT_CATEGORIES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setCategory(item.value)}
            className={`chip ${category === item.value ? '!bg-dusk-400 !text-cream-50' : ''}`}
          >
            {documentCategoryLabel(item.value, locale)}
          </button>
        ))}
      </div>

      {loading ? (
        <GlassCard className="p-6 text-sm text-dusk-300">{tr('Carregando...')}</GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <Sparkles className="w-8 h-8 mx-auto text-sage-700 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">{tr('Nenhum documento publicado ainda.')}</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            {tr('Quando a administração publicar documentos do prédio, eles aparecem aqui para consulta rápida.')}
          </p>
        </GlassCard>
      ) : (
        <div className="grid md:grid-cols-2 gap-3" data-testid="resident-documents-list">
          {filtered.map((doc) => (
            <GlassCard key={doc.id} className="p-5 flex items-start gap-4" data-testid={`resident-document-${doc.id}`}>
              <div className="w-11 h-11 rounded-2xl bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-xl text-dusk-500">{doc.title}</h3>
                  <Badge tone="neutral">{documentCategoryLabel(doc.category, locale)}</Badge>
                </div>
                {doc.description && <p className="text-sm text-dusk-300 mt-2">{doc.description}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-300">
                  {doc.document_date && <span className="rounded-full bg-white/60 px-3 py-1">{formatDate(doc.document_date)}</span>}
                  {doc.file_id ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500"
                      onClick={() => openUploadedFile(doc.file_id!, doc.file_name || doc.title)}
                    >
                      <ExternalLink className="w-3 h-3" /> {tr('abrir documento')}
                    </button>
                  ) : (
                    <a
                      className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500"
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3 h-3" /> {tr('abrir documento')}
                    </a>
                  )}
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <GlassCard variant="clay-sage" className="p-4 mt-5 flex items-start gap-3">
          <FileText className="w-5 h-5 text-sage-700 mt-0.5" />
          <p className="text-sm text-dusk-300">
            {tr('Não encontrou o documento que precisa? Peça para a administração publicar no cofre.')}
          </p>
        </GlassCard>
      )}
    </>
  );
}
