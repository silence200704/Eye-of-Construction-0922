export class SessionGate {
  private generation: number = 0;

  begin(): number {
    return ++this.generation;
  }

  current(generation: number): boolean {
    return generation === this.generation;
  }
}
