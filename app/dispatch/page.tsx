import { Suspense } from 'react';
import { fetchDispatchList } from '@/lib/appsScript';
import { StatBlock } from '@/components/StatBlock';
import { DispatchTable } from '@/components/DispatchTable';
import { UpstreamHealth } from '@/components/UpstreamHealth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dispatch — Droppy' };

// Tiles and the first page of rows come from one call. `summary` is always
// whole-log, never the filtered page, so the tiles stay still while someone
// types in the search box — a tile that moved with the filter would be worse
// than no tile at all.
async function DispatchView() {
  // Outstanding first: this page exists for the chase list, so that is what
  // the server renders before any interaction.
  const initial = await fetchDispatchList({ offset: 0, limit: 20, status: 'outstanding' });
  const s = initial.summary;

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock value={s.dispatched.toLocaleString()} label="Dispatched" hint="Scanned out, all time" />
        <StatBlock value={s.delivered.toLocaleString()} label="Delivered" tone="good" hint="Dispatched and arrived" />
        {/* The reason anyone opens this page. Always toned as a problem, even at
            zero, so its position in the row never shifts meaning. */}
        <StatBlock
          value={s.outstanding.toLocaleString()}
          label="Outstanding"
          tone={s.outstanding > 0 ? 'bad' : 'good'}
          hint={s.outstanding > 0 ? 'In flight, or lost — chase these' : 'Nothing in flight'}
        />
        <StatBlock
          value={s.deliveredNotDispatched.toLocaleString()}
          label="Audit gap"
          tone={s.deliveredNotDispatched > 0 ? 'warn' : 'neutral'}
          hint="Delivered with no door scan"
        />
      </div>

      {/* Second row, quieter than the tiles: these describe how well the
          pipeline is linked up, not what needs chasing. Each appears only once
          it has something to say — a zero here means "not happening yet",
          which is noise on a first run. */}
      {(s.splitParcels || s.linkedToPacking || s.avgHoursWaiting) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-faint">
          {typeof s.avgHoursWaiting === 'number' && (
            <span className="tabular">
              Average wait in the building:{' '}
              <span className="text-muted">
                {s.avgHoursWaiting < 1 ? 'under an hour' : `${Math.round(s.avgHoursWaiting)}h`}
              </span>
            </span>
          )}
          {Boolean(s.linkedToPacking) && (
            <span className="tabular">
              <span className="text-muted">{s.linkedToPacking}</span> linked to a packing record
            </span>
          )}
          {Boolean(s.splitParcels) && (
            <span className="tabular">
              <span className="text-muted">{s.splitParcels}</span> split parcels
            </span>
          )}
        </p>
      )}

      <div className="mt-6">
        <DispatchTable initial={initial} />
      </div>
    </>
  );
}

function TilesSkeleton() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-panel px-3.5 py-3 shadow-card">
          <div className="h-6 w-14 animate-pulse rounded bg-raised" />
          <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}

export default function DispatchPage() {
  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold text-ink">Dispatch</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Every parcel scanned out of the warehouse, and whether it was ever delivered.
      </p>

      {/* Its own boundary so a slow credential probe never delays the queue —
          and above the tiles, because a dead token explains an unresolved run. */}
      <div className="mt-4">
        <Suspense fallback={null}>
          <UpstreamHealth />
        </Suspense>
      </div>

      <Suspense fallback={<TilesSkeleton />}>
        <DispatchView />
      </Suspense>
    </div>
  );
}
