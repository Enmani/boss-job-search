import {api} from './client.js';
export function setupImport(onSaved) {
  const $=id=>document.getElementById(id),notice=$('import-notice');let busy=false;
  $('import-open').addEventListener('click',()=>{notice.hidden=true;$('import-dialog').showModal();});
  $('import-close').addEventListener('click',()=>$('import-dialog').close());
  $('import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;const button=$('import-form').querySelector('button[type=submit]');button.disabled=true;
    try {
      const compensation=[],hasSalary=['import-min','import-max','import-currency'].some(id=>$(id).value!=='');
      if(hasSalary) {
        if($('import-min').value==='' || $('import-max').value==='' || !/^[A-Z]{3}$/.test($('import-currency').value.trim().toUpperCase()))throw new Error('请填写完整薪资范围与币种');
        compensation.push({min:Number($('import-min').value),max:Number($('import-max').value),currency:$('import-currency').value.trim().toUpperCase(),period:$('import-period').value,label:''});
      }
      await api('import_job',{url:$('import-url').value.trim(),title:$('import-job-title').value.trim(),company:$('import-company').value.trim(),
        location:$('import-location').value.trim(),salary:$('import-salary').value.trim(),experience:$('import-experience').value.trim(),description:$('import-description').value,compensation});
      await onSaved();$('import-dialog').close();$('import-form').reset();
    } catch(error) {notice.hidden=false;notice.textContent=error.message;notice.className='error';}
    finally {busy=false;button.disabled=false;}
  });
}
