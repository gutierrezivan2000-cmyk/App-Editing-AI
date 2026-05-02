type ClassValue = string | number | boolean | undefined | null | ClassValue[];

function clsx(...args: ClassValue[]): string {
  return args
    .flat(Infinity)
    .filter(Boolean)
    .join(" ");
}

export function cn(...inputs: ClassValue[]): string {
  return clsx(...inputs);
}
