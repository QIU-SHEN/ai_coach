import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={clsx('animate-pulse bg-gray-200 rounded', className)}
    />
  );
}

type CircleSize = 'sm' | 'md' | 'lg';

const circleSizeMap: Record<CircleSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

interface SkeletonCircleProps {
  size?: CircleSize;
  className?: string;
}

export function SkeletonCircle({ size = 'md', className }: SkeletonCircleProps) {
  return (
    <div
      className={clsx('animate-pulse bg-gray-200 rounded-full shrink-0', circleSizeMap[size], className)}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={clsx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={clsx('h-4', i === lines - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  );
}
