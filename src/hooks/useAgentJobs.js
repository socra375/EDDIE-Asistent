import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJobs, markJobsSeen, startJob } from '../services/agentJobs';
import { isActive, toReport } from '../services/agentJobsCore';

const POLL_MS = 4000; // while a job is working

// The background jobs of the signed-in user: the list (for the chips), and `onFinished(job)` once for each one that
// ended and was not told yet — also those that ended while Eddie was closed. `start(id)` begins a queued job.
export function useAgentJobs({ enabled, onFinished }) {
  const [jobs, setJobs] = useState([]);
  const told = useRef(new Set());
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const refresh = useCallback(async () => {
    const list = await fetchJobs();
    if (!list) return [];
    setJobs(list);
    const done = toReport(list, told.current);
    if (done.length) {
      done.forEach((job) => told.current.add(job.id));
      done.forEach((job) => finished.current?.(job));
      markJobsSeen(done.map((j) => j.id));
    }
    return list;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, refresh]);

  const working = jobs.some(isActive);
  useEffect(() => {
    if (!enabled || !working) return undefined;
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, working, refresh]);

  const start = useCallback(
    (id, label) => {
      // Shown at once as working; the server's list replaces it on the next poll.
      setJobs((prev) => (prev.some((j) => j.id === id) ? prev : [{ id, label, status: 'running', confirmations: [], actions: [], steps: [], seen: false }, ...prev]));
      startJob(id).then(refresh);
    },
    [refresh],
  );

  return { jobs, start, refresh };
}
