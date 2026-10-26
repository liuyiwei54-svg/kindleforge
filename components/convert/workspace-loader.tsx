'use client';

import dynamic from 'next/dynamic';
import type { WorkspaceProps } from './workspace';

function WorkspaceSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8" aria-busy="true">
      <div className="h-4 w-24 animate-pulse rounded-full bg-paper/10" />
      <div className="mt-4 h-8 w-64 animate-pulse rounded-full bg-paper/10" />
      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-52 animate-pulse rounded-[20px] border border-paper/10 bg-ink-800/40" />
        <div className="h-52 animate-pulse rounded-[20px] border border-paper/10 bg-ink-800/40" />
      </div>
    </div>
  );
}

const Workspace = dynamic(() => import('./workspace').then((module) => module.Workspace), {
  ssr: false,
  loading: () => <WorkspaceSkeleton />,
});

/** Client boundary for the heavy workspace: keeps jszip + the engine worker out of the landing bundle. */
export function WorkspaceLoader(props: WorkspaceProps) {
  return <Workspace {...props} />;
}
