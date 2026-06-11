import { clsx } from 'clsx';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
};

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const initial = name?.charAt(0) || '?';
  return (
    <div
      className={clsx(
        'rounded-full flex items-center justify-center font-bold bg-blue-100 text-blue-600',
        sizeMap[size],
        className
      )}
    >
      {initial}
    </div>
  );
}
