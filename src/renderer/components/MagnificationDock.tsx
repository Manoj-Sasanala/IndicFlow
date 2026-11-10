/**
 * IndicFlowMagnificationDock.tsx
 * 
 * A premium macOS-inspired magnification dock with fluid spring physics,
 * tooltips, and cosmic obsidian / solar saffron design tokens.
 * Built with Framer Motion.
 */

import React, { Children, cloneElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  MotionValue,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
  type SpringOptions
} from 'framer-motion';

export type DockItemData = {
  id?: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  isPrimary?: boolean;
  className?: string;
};

export type DockProps = {
  items: DockItemData[];
  className?: string;
  distance?: number;
  panelHeight?: number;
  baseItemSize?: number;
  dockHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
};

type DockItemProps = {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  distance: number;
  baseItemSize: number;
  magnification: number;
  isActive?: boolean;
  isPrimary?: boolean;
};

function DockItem({
  children,
  className = '',
  onClick,
  mouseX,
  spring,
  distance,
  magnification,
  baseItemSize,
  isActive,
  isPrimary
}: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? {
      x: 0,
      width: baseItemSize
    };
    return val - rect.x - baseItemSize / 2;
  });

  const targetSize = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [baseItemSize, magnification, baseItemSize]
  );
  const size = useSpring(targetSize, spring);

  return (
    <motion.div
      ref={ref}
      style={{
        width: size,
        height: size
      }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={onClick}
      className={`relative inline-flex items-center justify-center rounded-full transition-colors cursor-pointer select-none outline-none ${
        isPrimary
          ? 'bg-gradient-to-tr from-amber-500 to-violet-600 text-white shadow-[0_0_18px_rgba(249,115,22,0.45)]'
          : isActive
          ? 'bg-violet-600/30 border-violet-500/60 text-violet-300 shadow-[0_0_12px_rgba(124,58,237,0.35)]'
          : 'bg-[#161a26] border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
      } ${className}`}
      tabIndex={0}
      role="button"
      aria-haspopup="true"
    >
      {Children.map(children, (child) =>
        React.isValidElement(child)
          ? cloneElement(child as React.ReactElement<{ isHovered?: MotionValue<number> }>, { isHovered })
          : child
      )}
    </motion.div>
  );
}

type DockLabelProps = {
  className?: string;
  children: React.ReactNode;
  isHovered?: MotionValue<number>;
};

function DockLabel({ children, className = '', isHovered }: DockLabelProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isHovered) return;
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0, scale: 0.92 }}
          animate={{ opacity: 1, y: -12, scale: 1 }}
          exit={{ opacity: 0, y: 0, scale: 0.92 }}
          transition={{ duration: 0.16 }}
          className={`${className} absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/15 bg-[#121520] px-2.5 py-1 text-[11px] font-medium text-slate-200 shadow-xl backdrop-blur-md pointer-events-none z-50`}
          role="tooltip"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DockIconProps = {
  className?: string;
  children: React.ReactNode;
  isHovered?: MotionValue<number>;
};

function DockIcon({ children, className = '' }: DockIconProps) {
  return <div className={`flex items-center justify-center ${className}`}>{children}</div>;
}

export function MagnificationDock({
  items,
  className = '',
  spring = { mass: 0.1, stiffness: 160, damping: 13 },
  magnification = 68,
  distance = 180,
  panelHeight = 60,
  dockHeight = 256,
  baseItemSize = 46
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(() => Math.max(dockHeight, magnification + magnification / 2 + 4), [dockHeight, magnification]);
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div style={{ height, scrollbarWidth: 'none' }} className="flex max-w-full items-center justify-center select-none">
      <motion.div
        onMouseMove={({ pageX }) => {
          isHovered.set(1);
          mouseX.set(pageX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={`${className} flex items-end w-fit gap-2.5 rounded-2xl border border-white/10 bg-[#0e111a]/85 backdrop-blur-2xl pb-2 px-3.5 shadow-2xl`}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, index) => (
          <DockItem
            key={item.id || index}
            onClick={item.onClick}
            className={item.className}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
            isActive={item.isActive}
            isPrimary={item.isPrimary}
          >
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  );
}

export default MagnificationDock;
