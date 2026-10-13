const params=new URLSearchParams(location.hash.slice(1));
const token=params.get('token'),profile=params.get('profile') || 'personal';
export const hasAccess=/^[a-f0-9]{64}$/.test(token || '');
export async function api(name,args={}) {
  const response=await fetch(`/api/tools/${name}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({profile,...args})});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.message || '读取失败，请重试');error.code=data.code;throw error;}
  return data;
}
export function setTheme(value) {
  document.documentElement.dataset.theme=value;localStorage.setItem('job-panel-theme',value);
}
setTheme(localStorage.getItem('job-panel-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
for(const link of document.querySelectorAll('[data-panel-page]'))link.href=link.dataset.panelPage+location.hash;
