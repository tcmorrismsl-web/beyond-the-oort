/**
 * The small notice at the top right ("Saved", "Out of fuel"…). One shared
 * timer so overlapping messages don't hide each other early.
 */
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, ms = 1600): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => {
    toast.classList.remove('show');
  }, ms);
}
