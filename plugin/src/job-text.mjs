import { compile } from 'html-to-text';
import { decodeHTML } from 'entities';

const toText=compile({wordwrap:false,limits:{maxInputLength:1000000},selectors:[
  {selector:'a',options:{ignoreHref:true}},{selector:'img',format:'skip'},
  {selector:'h1',options:{uppercase:false}},{selector:'h2',options:{uppercase:false}},
  {selector:'h3',options:{uppercase:false}},
]});
export function descriptionText(content) {
  // Some public boards return entity-encoded markup. Conversion never executes it.
  let html=content;
  for(let pass=0;pass<2 && /&(?:amp;)?lt;\/?(?:p|div|ul|li|br|h[1-6]|strong|span)\b/i.test(html);pass++)html=decodeHTML(html);
  return toText(html).trim();
}
