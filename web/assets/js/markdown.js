// Render the chat Markdown subset with DOM nodes; model HTML is always plain text.
function inline(parent, source, depth = 0) {
  if (depth > 12) { parent.append(document.createTextNode(source)); return; }
  const tokens = /(`+)([\s\S]*?)\1|\*\*([^\n]+?)\*\*|__([^\n]+?)__|~~([^\n]+?)~~|\*([^*\n]+?)\*|_([^_\n]+?)_|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    parent.append(document.createTextNode(source.slice(offset, match.index)));
    let node;
    if (match[1]) { node = document.createElement('code'); node.textContent = match[2]; }
    else if (match[8]) {
      let url;
      try { url = new URL(match[9], location.href); } catch { url = null; }
      if (url && ['https:', 'http:', 'mailto:'].includes(url.protocol)) {
        node = document.createElement('a'); node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; inline(node, match[8], depth + 1);
      } else { node = document.createTextNode(match[0]); }
    } else {
      node = document.createElement(match[3] || match[4] ? 'strong' : match[5] ? 'del' : 'em');
      inline(node, match[3] || match[4] || match[5] || match[6] || match[7], depth + 1);
    }
    parent.append(node); offset = match.index + match[0].length;
  }
  parent.append(document.createTextNode(source.slice(offset)));
}

export function renderMarkdown(target, source, depth = 0) {
  target.classList.add('agent-markdown');
  target.replaceChildren();
  if (depth > 16) { target.textContent = String(source || ''); return; }
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const fence = line => line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  const list = line => line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
  const tableRule = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  const blockStart = (line, next) => !line.trim() || fence(line) || /^(#{1,6})\s|^\s*>|^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line) || list(line) || (next && tableRule(next));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const opening = fence(line);
    if (opening) {
      const body = [], marker = opening[1]; i++;
      while (i < lines.length && !new RegExp('^\\s{0,3}' + marker[0] + '{' + marker.length + ',}\\s*$').test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      const frame = document.createElement('div'), bar = document.createElement('div'), language = document.createElement('span'), copy = document.createElement('button'), pre = document.createElement('pre'), code = document.createElement('code');
      frame.className = 'agent-code'; bar.className = 'agent-code-bar'; language.textContent = opening[2].trim() || '代码';
      copy.type = 'button'; copy.textContent = '复制'; copy.setAttribute('aria-label', '复制代码'); code.textContent = body.join('\n');
      copy.onclick = async () => {
        try {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(code.textContent); copy.textContent = '已复制';
        } catch {
          const selection = getSelection(), range = document.createRange(); range.selectNodeContents(code); selection.removeAllRanges(); selection.addRange(range); copy.textContent = '已选中，请复制';
        }
      };
      bar.append(language, copy); pre.append(code); frame.append(bar, pre); target.append(frame); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { const node = document.createElement('h' + heading[1].length); inline(node, heading[2]); target.append(node); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { target.append(document.createElement('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = []; while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*> ?/, ''));
      const node = document.createElement('blockquote'); renderMarkdown(node, body.join('\n'), depth + 1); target.append(node); continue;
    }
    if (i + 1 < lines.length && tableRule(lines[i + 1])) {
      const wrap = document.createElement('div'), table = document.createElement('table'), head = document.createElement('thead'), row = document.createElement('tr'), tbody = document.createElement('tbody');
      wrap.className = 'agent-table'; wrap.tabIndex = 0; wrap.setAttribute('aria-label', '表格，可横向滚动');
      for (const value of cells(line)) { const cell = document.createElement('th'); inline(cell, value); row.append(cell); }
      head.append(row); i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const tr = document.createElement('tr'); for (const value of cells(lines[i++])) { const td = document.createElement('td'); inline(td, value); tr.append(td); } tbody.append(tr);
      }
      table.append(head, tbody); wrap.append(table); target.append(wrap); continue;
    }
    const first = list(line);
    if (first) {
      const ordered = /^\d/.test(first[2]), node = document.createElement(ordered ? 'ol' : 'ul'), indent = first[1].length;
      if (ordered) node.start = parseInt(first[2], 10);
      while (i < lines.length) {
        const item = list(lines[i]); if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
        const li = document.createElement('li'); inline(li, item[3]); i++;
        const nested = [];
        while (i < lines.length && lines[i].trim() && /^\s+/.test(lines[i]) && lines[i].match(/^\s*/)[0].length > indent) nested.push(lines[i++].slice(indent + 2));
        if (nested.length) { const inner = document.createElement('div'); renderMarkdown(inner, nested.join('\n'), depth + 1); li.append(inner); }
        node.append(li);
      }
      target.append(node); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && !blockStart(lines[i], lines[i + 1])) paragraph.push(lines[i++]);
    const node = document.createElement('p'); inline(node, paragraph.join('\n')); target.append(node);
  }
}
