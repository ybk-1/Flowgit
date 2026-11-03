/** One event of the board's stream, as the local board's SSE would send it. */
export interface Frame {
  id: number;
  event: string;
  data: string;
}

/**
 * Stands in for EventSource: the board listens to it the same way. It opens on the next tick and
 * replays the current run's events, like the local board does for a late client.
 */
export class LocalEventSource extends EventTarget {
  readyState = 0;
  readonly url: string;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    url: string,
    private readonly hub: EventHub,
  ) {
    super();
    this.url = url;
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      for (const frame of hub.history) this.deliver(frame);
      hub.sources.add(this);
    }, 0);
  }

  deliver(frame: Frame): void {
    if (this.readyState !== 1) return;
    this.dispatchEvent(new MessageEvent(frame.event, { data: frame.data, lastEventId: String(frame.id) }));
  }

  close(): void {
    this.readyState = 2;
    this.hub.sources.delete(this);
  }
}

export class EventHub {
  nextId = 0;
  history: Frame[] = [];
  readonly sources = new Set<LocalEventSource>();

  publish(event: string, data: unknown, remember = true): void {
    const frame: Frame = { id: ++this.nextId, event, data: JSON.stringify(data) };
    if (remember) this.history.push(frame);
    for (const source of [...this.sources]) source.deliver(frame);
  }

  open(url: string): LocalEventSource {
    return new LocalEventSource(url, this);
  }
}
