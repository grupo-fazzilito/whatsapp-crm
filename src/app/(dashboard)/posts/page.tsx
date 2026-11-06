import { Suspense } from 'react';
import { PostsManager } from '@/components/posts/posts-manager';

export default function PostsPage() {
  return (
    <Suspense>
      <PostsManager />
    </Suspense>
  );
}
