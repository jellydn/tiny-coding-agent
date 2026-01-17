export function isTTY(): boolean {
  return process.stdout.isTTY === true && process.stdin.isTTY === true;
}

let forceNoColor = false;
let forceJson = false;

export function setNoColor(value: boolean): void {
  forceNoColor = value;
}

export function setJsonMode(value: boolean): void {
  forceJson = value;
}

export function isJsonMode(): boolean {
  return forceJson;
}

export function shouldUseInk(): boolean {
  if (forceNoColor || forceJson) {
    return false;
  }
  return isTTY();
}
