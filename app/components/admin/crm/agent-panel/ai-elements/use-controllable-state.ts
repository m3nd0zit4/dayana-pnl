import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Local stand-in for `@radix-ui/react-use-controllable-state` — this project
 * uses Base UI, not Radix, and pulling in a Radix package for one 20-line hook
 * isn't worth the dependency. Same contract: works controlled (`prop` set) or
 * uncontrolled (falls back to internal state seeded by `defaultProp`).
 */
export function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop?: T;
  defaultProp: T;
  onChange?: (value: T) => void;
}): [T, (value: T) => void] {
  const [uncontrolled, setUncontrolled] = useState(defaultProp);
  const isControlled = prop !== undefined;
  const value = isControlled ? prop : uncontrolled;

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setUncontrolled(next);
      onChangeRef.current?.(next);
    },
    [isControlled]
  );

  return [value, setValue];
}
