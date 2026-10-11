import { TemplateEditor } from '@/components/templates/template-editor';

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditor key={id} templateId={id} />;
}
