import {
  Baby,
  BookOpen,
  Car,
  Coffee,
  Dumbbell,
  Ellipsis,
  Film,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  type LucideIcon,
  Music,
  PawPrint,
  Plane,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Utensils,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** The icons a category can use. Stored by name, so adding one here is all it takes. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  car: Car,
  house: House,
  zap: Zap,
  'shopping-bag': ShoppingBag,
  'heart-pulse': HeartPulse,
  film: Film,
  plane: Plane,
  ellipsis: Ellipsis,
  coffee: Coffee,
  gift: Gift,
  'graduation-cap': GraduationCap,
  dumbbell: Dumbbell,
  baby: Baby,
  'paw-print': PawPrint,
  wrench: Wrench,
  'book-open': BookOpen,
  music: Music,
  tag: Tag,
};

export const CATEGORY_COLORS = [
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#eab308',
  '#ec4899',
  '#ef4444',
  '#14b8a6',
  '#0ea5e9',
  '#64748b',
];

interface CategoryIconProps {
  icon: string | undefined;
  color: string | undefined;
  className?: string;
}

/** A round coloured badge with the category's icon. */
export function CategoryIcon({ icon, color = '#64748b', className }: CategoryIconProps) {
  const Icon = (icon && CATEGORY_ICONS[icon]) || Tag;
  return (
    <span
      className={cn('grid size-10 shrink-0 place-items-center rounded-2xl', className)}
      style={{ backgroundColor: `${color}26`, color }}
      aria-hidden="true"
    >
      <Icon className="size-5" />
    </span>
  );
}
