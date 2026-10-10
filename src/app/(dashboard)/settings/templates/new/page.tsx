import { TemplateEditor } from '@/components/templates/template-editor';

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ suggestion?: string | string[] }> }) {
  const { suggestion } = await searchParams;
  return <TemplateEditor suggestionId={typeof suggestion === 'string' ? suggestion : undefined} />;
}
