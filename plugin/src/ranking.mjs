import { constraintHints } from './domain.mjs';

const order = ['推荐','待核实','未筛选','需复核','不符合'];
export function rankJobs(jobs, preferences, {includeRejected=true}={}) {
  const ranked = jobs.map((job, index) => {
    const hints = constraintHints(job, preferences), current = job.assessment && !job.assessment.stale;
    const assessmentState = job.assessment ? current ? '已筛选' : '需复核' : '未筛选';
    const group = hints.some(value=>value.kind==='不符合') || (current && job.assessment.decision==='不符合') ? '不符合'
      : hints.length ? '待核实' : current ? job.assessment.decision : assessmentState;
    return {...job,ranking:{group,assessmentState,hints},index};
  }).filter(job=>includeRejected || job.ranking.group!=='不符合');
  ranked.sort((a,b)=>order.indexOf(a.ranking.group)-order.indexOf(b.ranking.group) || a.index-b.index);
  return ranked.map(({index,...job})=>job);
}
