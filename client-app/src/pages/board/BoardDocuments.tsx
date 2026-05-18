import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ExternalLink, FileText, FolderOpen, Lock, Pencil, Plus, Save, Trash2, UploadCloud, Users, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDate, t, type AppLocale, useLocale } from '../../lib/i18n';
import { openUploadedFile, uploadFileToCondoOS } from '../../lib/uploads';

export interface BuildingDocument {
  id: number;
  title: string;
  category: string;
  description: string | null;
  // Phase 1 — file_url is now nullable. Either file_url (external link)
  // or file_id (uploaded blob) is set, never both. The render below
  // already branches on file_id to call openUploadedFile() instead of
  // the <a href> path.
  file_url: string | null;
  file_id: number | null;
  file_name: string | null;
  file_content_type: string | null;
  file_size_bytes: number | null;
  document_date: string | null;
  visibility: 'residents' | 'board_only';
  active: number;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

type DocumentForm = {
  title: string;
  category: string;
  description: string;
  file_url: string;
  file_id: number | null;
  document_date: string;
  visibility: 'residents' | 'board_only';
  active: boolean;
};

export const DOCUMENT_CATEGORIES = [
  { value: 'rules', label: 'Regulamento' },
  { value: 'minutes', label: 'Atas e reuniões' },
  { value: 'contracts', label: 'Contratos' },
  { value: 'insurance', label: 'Seguros' },
  { value: 'warranties', label: 'Garantias' },
  { value: 'receipts', label: 'Recibos' },
  { value: 'vendors', label: 'Fornecedores' },
  { value: 'notices', label: 'Avisos formais' },
  { value: 'other', label: 'Outros' },
];

const blankForm: DocumentForm = {
  title: '',
  category: 'rules',
  description: '',
  file_url: '',
  file_id: null,
  document_date: new Date().toISOString().slice(0, 10),
  visibility: 'residents',
  active: true,
};

export function documentCategoryLabel(value: string, locale: AppLocale) {
  const category = DOCUMENT_CATEGORIES.find((c) => c.value === value);
  return t(category?.label || value, locale);
}

export function documentVisibilityLabel(value: BuildingDocument['visibility'], locale: AppLocale) {
  return value === 'board_only'
    ? t('Apenas administração', locale)
    : t('Visível para moradores', locale);
}

function normalize(form: DocumentForm) {
  return {
    title: form.title.trim(),
    category: form.category,
    description: form.description.trim() || null,
    file_url: form.file_url.trim() || null,
    file_id: form.file_id,
    document_date: form.document_date || null,
    visibility: form.visibility,
    active: form.active,
  };
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

export default function BoardDocuments() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [rows, setRows] = useState<BuildingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [category, setCategory] = useState('all');

  async function load() {
    setLoading(true);
    try {
      setRows(await apiGet<BuildingDocument[]>('/documents?include_inactive=1'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => rows.filter((doc) => category === 'all' || doc.category === category),
    [rows, category],
  );

  const publishedCount = rows.filter((doc) => doc.active && doc.visibility === 'residents').length;
  const boardOnlyCount = rows.filter((doc) => doc.active && doc.visibility === 'board_only').length;

  return (
    <>
      <PageHeader
        title={tr('Documentos')}
        subtitle={loading
          ? tr('Carregando...')
          : `${publishedCount} ${tr(publishedCount === 1 ? 'publicado' : 'publicados')} · ${boardOnlyCount} ${tr(boardOnlyCount === 1 ? 'interno' : 'internos')}`}
        actions={
          <Button
            variant={showNew ? 'ghost' : 'primary'}
            onClick={() => setShowNew((x) => !x)}
            leftIcon={showNew ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showNew ? tr('Cancelar') : tr('Novo documento')}
          </Button>
        }
      />

      <GlassCard variant="clay" className="p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-xl text-dusk-500">{tr('Cofre de documentos do prédio')}</h2>
            <p className="text-sm text-dusk-300 mt-1">
              {tr('Publique regras, atas, contratos, seguros, garantias, recibos e documentos de fornecedores em um lugar só.')}
            </p>
          </div>
        </div>
      </GlassCard>

      {showNew && (
        <DocumentEditor
          mode="create"
          initial={blankForm}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}

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

      <div className="space-y-3" data-testid="board-documents-list">
        {filtered.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} onChanged={load} />
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <GlassCard className="p-8 text-center">
          <FileText className="w-8 h-8 mx-auto text-sage-700 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">{tr('Nenhum documento encontrado.')}</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            {tr('Adicione o primeiro documento para que moradores e administração encontrem tudo sem pedir no grupo.')}
          </p>
        </GlassCard>
      )}
    </>
  );
}

function DocumentRow({ doc, onChanged }: { doc: BuildingDocument; onChanged: () => void }) {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [editing, setEditing] = useState(false);

  async function deactivate() {
    if (!confirm(`${tr('Arquivar documento')} "${doc.title}"?`)) return;
    try {
      await apiDelete(`/documents/${doc.id}`);
      toast.success(tr('Documento arquivado'));
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao arquivar documento'));
    }
  }

  if (editing) {
    return (
      <DocumentEditor
        mode="edit"
        id={doc.id}
        initial={{
          title: doc.title,
          category: doc.category,
          description: doc.description || '',
          file_url: doc.file_url || '',
          file_id: doc.file_id || null,
          document_date: doc.document_date ? doc.document_date.slice(0, 10) : '',
          visibility: doc.visibility,
          active: !!doc.active,
        }}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged(); }}
      />
    );
  }

  return (
    <GlassCard className={`p-5 ${doc.active ? '' : 'opacity-60'}`} data-testid={`board-document-${doc.id}`}>
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-white/70 border border-white/80 text-dusk-400 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-xl text-dusk-500">{doc.title}</h3>
            <Badge tone="neutral">{documentCategoryLabel(doc.category, locale)}</Badge>
            <Badge tone={doc.visibility === 'residents' ? 'sage' : 'warning'}>
              {doc.visibility === 'residents' ? <Users className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {documentVisibilityLabel(doc.visibility, locale)}
            </Badge>
            {!doc.active ? <Badge tone="neutral">{tr('arquivado')}</Badge> : null}
          </div>
          {doc.description && <p className="text-sm text-dusk-300 mt-2">{doc.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-300">
            {doc.document_date && <span className="rounded-full bg-white/60 px-3 py-1">{formatDate(doc.document_date)}</span>}
            {doc.uploaded_by_name && <span className="rounded-full bg-white/60 px-3 py-1">{tr('Enviado por')} {doc.uploaded_by_name}</span>}
            {doc.file_id ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500"
                onClick={() => openUploadedFile(doc.file_id!, doc.file_name || doc.title)}
              >
                <ExternalLink className="w-3 h-3" /> {tr('abrir documento')}
              </button>
            ) : doc.file_url ? (
              <a
                className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500"
                href={doc.file_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-3 h-3" /> {tr('abrir documento')}
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="p-2 text-dusk-300 hover:text-dusk-500" title={tr('Editar documento')} aria-label={`${tr('Editar documento')} ${doc.title}`}>
            <Pencil className="w-4 h-4" />
          </button>
          {doc.active ? (
            <button onClick={deactivate} className="p-2 text-dusk-300 hover:text-peach-600" title={tr('Arquivar documento')} aria-label={`${tr('Arquivar documento')} ${doc.title}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

function DocumentEditor({
  mode,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit';
  id?: number;
  initial: DocumentForm;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [form, setForm] = useState<DocumentForm>(initial);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error(tr('Informe o título do documento.'));
      return;
    }
    if (!selectedFile && !form.file_id && !isHttpsUrl(form.file_url)) {
      toast.error(tr('Envie um arquivo ou use um link seguro começando com https://.'));
      return;
    }

    setSaving(true);
    try {
      let body = normalize(form);
      if (selectedFile) {
        const uploaded = await uploadFileToCondoOS(selectedFile, {
          purpose: 'document',
          visibility: form.visibility,
        });
        body = { ...body, file_id: uploaded.id, file_url: null };
      } else if (body.file_url) {
        body = { ...body, file_id: null };
      }
      if (mode === 'create') {
        await apiPost<{ id: number }>('/documents', body);
      } else {
        await apiPatch<{ id: number }>(`/documents/${id}`, body);
      }
      toast.success(mode === 'create' ? tr('Documento publicado') : tr('Documento atualizado'));
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao salvar documento'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-5 mb-5 animate-fade-up" data-testid="document-editor">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-xl text-dusk-500">{mode === 'create' ? tr('Novo documento') : tr('Editar documento')}</h2>
        <button onClick={onCancel} className="text-dusk-300 hover:text-dusk-500" aria-label={tr('Cancelar')}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
        <label className="block text-xs text-dusk-300 font-medium">
          {tr('Título')}
          <input
            className="input mt-1"
            data-testid="document-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={160}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {tr('Categoria')}
          <select
            className="input mt-1"
            data-testid="document-category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {DOCUMENT_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>{documentCategoryLabel(item.value, locale)}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {tr('Data do documento')}
          <input
            className="input mt-1"
            data-testid="document-date"
            type="date"
            value={form.document_date}
            onChange={(e) => setForm({ ...form, document_date: e.target.value })}
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {tr('Visibilidade')}
          <select
            className="input mt-1"
            data-testid="document-visibility"
            value={form.visibility}
            onChange={(e) => setForm({ ...form, visibility: e.target.value as DocumentForm['visibility'] })}
          >
            <option value="residents">{tr('Visível para moradores')}</option>
            <option value="board_only">{tr('Apenas administração')}</option>
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {tr('Arquivo do documento')}
          <input
            className="input mt-1"
            data-testid="document-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,text/plain,application/pdf,image/*"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          />
          <span className="text-[11px] text-dusk-200 mt-1 block">
            {selectedFile
              ? `${tr('Selecionado:')} ${selectedFile.name}`
              : form.file_id
                ? tr('Arquivo já armazenado no CondoOS.')
                : tr('Envie um PDF, imagem ou documento, ou cole um link seguro abaixo.')}
          </span>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {tr('Link seguro (https://)')}
          <input
            className="input mt-1"
            data-testid="document-url"
            type="url"
            value={form.file_url}
            onChange={(e) => setForm({ ...form, file_url: e.target.value, file_id: e.target.value.trim() ? null : form.file_id })}
            placeholder="https://..."
            maxLength={2048}
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {tr('Descrição')}
          <textarea
            className="input mt-1 min-h-[88px]"
            data-testid="document-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={1000}
          />
        </label>
        {mode === 'edit' && (
          <label className="md:col-span-2 inline-flex items-center gap-2 text-xs text-dusk-400 bg-white/60 border border-white/70 rounded-full px-3 py-1.5 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            {tr('Documento ativo')}
          </label>
        )}
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>{tr('Cancelar')}</Button>
          <Button type="submit" variant="primary" loading={saving} leftIcon={selectedFile ? <UploadCloud className="w-4 h-4" /> : <Save className="w-4 h-4" />}>{tr('Salvar')}</Button>
        </div>
      </form>
    </GlassCard>
  );
}
