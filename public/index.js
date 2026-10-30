// Admin panel logic (refactored into IIFE, no inline handlers)
(function(){
// Support hosting under a sub-path (e.g. /kiduyuTv_providers). The prefix is
// whatever directory the page itself was served from, so this works whether or
// not MOUNT_PATH is configured on the server.
// Support hosting under a sub-path (e.g. /kiduyuTv_providers). Strip a trailing
// slash and any page filename, but never strip a bare mount segment (e.g.
// "/kiduyuTv_providers" with no trailing slash is a valid page URL).
const BASE = window.location.pathname.replace(/\/+$/, '').replace(/\/[^/]*\.[^/]*$/, '');
const U = p => BASE + p;
let consoleLogCursor = 0;
let consoleLogsTimer = null;
let consoleLogsLoading = false;
let consoleLogsLoaded = false;
function formatConsoleLogEntry(entry){
	return `[${entry.timestamp}] [${String(entry.level || 'log').toUpperCase()}] ${entry.message}`;
}
async function refreshConsoleLogs(){
	const output = document.getElementById('consoleLogOutput');
	const status = document.getElementById('consoleLogStatus');
	if(!output || consoleLogsLoading) return;
	consoleLogsLoading = true;
	try {
		const response = await fetch(U(`/api/logs?since=${consoleLogCursor}`), { cache:'no-store' });
		if(response.status === 401){ location.replace(U('/?expired=1')); return; }
		if(!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		const additions = [];
		if(data.missedCount > 0){
			additions.push(`[${new Date().toISOString()}] [warning] ${data.missedCount} earlier log entr${data.missedCount === 1 ? 'y was' : 'ies were'} dropped from server memory.`);
		}
		for(const entry of data.entries || []){
			if(!entry || entry.message === undefined || entry.message === null) continue;
			additions.push(formatConsoleLogEntry(entry));
		}
		if(output.textContent === 'Waiting for logs...' || (additions.length && output.textContent === 'No console output captured yet.')) output.textContent = '';
		if(additions.length) output.append(document.createTextNode(`${additions.join('\n')}\n`));
		if(!consoleLogsLoaded && !data.totalEntries) output.textContent = 'No console output captured yet.';
		consoleLogsLoaded = true;
		consoleLogCursor = Number(data.cursor) || consoleLogCursor;
		output.scrollTop = output.scrollHeight;
		if(status){
			const captured = Number(data.totalEntries || 0).toLocaleString();
			const retained = Number(data.retainedEntries || 0).toLocaleString();
			const dropped = Number(data.droppedEntries || 0).toLocaleString();
			status.textContent = `${retained} retained / ${captured} captured; ${dropped} older entries dropped. Updated ${new Date().toLocaleTimeString()}.`;
		}
	} catch(error){
		if(status) status.textContent = `Log refresh failed: ${error.message}`;
	} finally {
		consoleLogsLoading = false;
	}
}
function startConsoleLogPolling(){
	if(consoleLogsTimer) return;
	refreshConsoleLogs();
	consoleLogsTimer = setInterval(()=>{
		if(document.visibilityState === 'visible') refreshConsoleLogs();
	}, 5000);
}
function stopConsoleLogPolling(){
	if(consoleLogsTimer){ clearInterval(consoleLogsTimer); consoleLogsTimer = null; }
}
// Downloads the console history as a .log file. Uses since=0 so the file holds
// the full retained server history rather than only the lines on screen.
async function saveConsoleLogsAsFile(){
	const status = document.getElementById('consoleLogStatus');
	const button = document.getElementById('saveConsoleLogsBtn');
	if(button) button.disabled = true;
	if(status) status.textContent = 'Collecting console logs…';
	try {
		const response = await fetch(U('/api/logs?since=0'), { cache:'no-store' });
		if(response.status === 401){ location.replace(U('/?expired=1')); return; }
		if(!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		const lines = [];
		if(data.missedCount > 0){
			lines.push(`[${new Date().toISOString()}] [WARNING] ${data.missedCount} earlier log entr${data.missedCount === 1 ? 'y was' : 'ies were'} dropped from server memory.`);
		}
		for(const entry of data.entries || []){
			if(!entry || entry.message === undefined || entry.message === null) continue;
			lines.push(formatConsoleLogEntry(entry));
		}
		const captured = Number(data.totalEntries || 0).toLocaleString();
		const retained = Number(data.retainedEntries || 0).toLocaleString();
		const dropped = Number(data.droppedEntries || 0).toLocaleString();
		const header = [
			'# tmdb-embed-api console logs',
			`# exported: ${new Date().toISOString()}`,
			`# entries: ${lines.length.toLocaleString()} of ${captured} captured (${retained} retained, ${dropped} dropped)`,
			''
		].join('\n');
		const body = lines.length ? `${lines.join('\n')}\n` : '# no console output captured yet.\n';
		const blob = new Blob([header + body], { type:'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const filename = `tmdb-embed-api-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(()=>URL.revokeObjectURL(url), 1000);
		if(status) status.textContent = `Saved ${lines.length.toLocaleString()} log entr${lines.length === 1 ? 'y' : 'ies'} to ${filename}.`;
	} catch(error){
		if(status) status.textContent = `Log save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}
async function fetchConfig(){
	const r = await fetch(U('/api/config'));
	if(!r.ok) throw new Error('Failed to fetch config');
	return r.json();
}
async function fetchProviders(){
	const r = await fetch(U('/api/providers'));
	if(!r.ok) throw new Error('Failed to fetch providers');
	return r.json();
}

async function renderMovieboxSettings(settings = {}){
	const container = document.getElementById('movieboxSettingsControls');
	if(!container) return;
	container.replaceChildren();
	try {
		const response = await fetch(U('/api/providers/moviebox/settings'));
		if(!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		if(!data.success || !Array.isArray(data.layout)) throw new Error('Invalid settings response');
		settings = data.settings || settings;
		let grid = null;
		for(const item of data.layout){
			if(item.type === 'header'){
				grid = null;
				const heading = document.createElement('h2');
				heading.textContent = item.label;
				container.appendChild(heading);
			} else if(item.type === 'info'){
				grid = null;
				const info = document.createElement('p');
				info.className = 'hint';
				info.textContent = item.label;
				container.appendChild(info);
			} else if(item.type === 'toggle'){
				if(!grid){
					grid = document.createElement('div');
					grid.className = 'adv-flag-grid';
					container.appendChild(grid);
				}
				const label = document.createElement('label');
				label.className = 'adv-flag-item';
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.dataset.movieboxSetting = item.key;
				checkbox.checked = Object.prototype.hasOwnProperty.call(settings, item.key)
					? settings[item.key] === true
					: item.defaultValue === true;
				if(checkbox.checked) label.classList.add('on');
				const text = document.createElement('span');
				text.textContent = item.label;
				label.append(checkbox, text);
				if(item.description) label.title = item.description;
				grid.appendChild(label);
			}
		}
		const proxyEnabled = document.getElementById('movieboxProxyEnabled');
		const proxyLabel = document.getElementById('movieboxProxyEnabledLabel');
		const proxyLabelText = proxyLabel?.querySelector('.moviebox-proxy-toggle__label');
		if(proxyEnabled) {
			proxyEnabled.checked = settings.proxy_enabled === true;
			proxyLabel?.classList.toggle('on', proxyEnabled.checked);
			if(proxyLabelText) proxyLabelText.textContent = proxyEnabled.checked ? 'Proxy enabled' : 'Enable proxy';
		}
		const proxyStatus = document.getElementById('movieboxProxyStatus');
		try {
			const statusResponse = await fetch(U('/api/providers/moviebox/proxy-status'), { cache:'no-store' });
			const proxy = await statusResponse.json();
			if(!statusResponse.ok || !proxy.success) throw new Error(proxy.error || `HTTP ${statusResponse.status}`);
			if(proxyStatus) {
				proxyStatus.textContent = proxy.selectedProxy
					? `Selected: ${proxy.selectedProxy}`
					: proxy.listAvailable
						? `Proxy list is saved in utils. ${proxy.enabled ? 'A proxy will be selected on the next MovieBox request.' : 'Enable proxying to select one on the next MovieBox request.'}`
						: 'The preferred proxy will be checked first. Download the ProxyScrape JSON to provide fallback candidates.';
			}
		} catch(error) {
			if(proxyStatus) proxyStatus.textContent = `Unable to load proxy status: ${error.message}`;
		}
		const saveButton = document.getElementById('saveMovieboxSettingsBtn');
		if(saveButton) saveButton.disabled = false;
		if(!container._bound){
			container.addEventListener('change', event=>{
				if(event.target.matches('[data-moviebox-setting]')){
					event.target.closest('.adv-flag-item').classList.toggle('on', event.target.checked);
				}
			});
			container._bound = true;
		}
	} catch(error){
		const saveButton = document.getElementById('saveMovieboxSettingsBtn');
		if(saveButton) saveButton.disabled = true;
		container.textContent = `Unable to load MovieBox settings: ${error.message}`;
	}
}

async function renderVidfastProxySettings(enabled = false){
	const checkbox = document.getElementById('vidfastProxyEnabled');
	const label = document.getElementById('vidfastProxyEnabledLabel');
	const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
	const status = document.getElementById('vidfastProxyStatus');
	if(checkbox) {
		checkbox.checked = enabled === true;
		label?.classList.toggle('on', checkbox.checked);
		if(labelText) labelText.textContent = checkbox.checked ? 'Proxy enabled' : 'Enable proxy';
	}
	if(!status) return;
	try {
		const response = await fetch(U('/api/providers/vidfast/proxy-status'), { cache:'no-store' });
		const proxy = await response.json();
		if(!response.ok || !proxy.success) throw new Error(proxy.error || `HTTP ${response.status}`);
		status.textContent = proxy.selectedProxy
			? `Selected: ${proxy.selectedProxy}`
			: proxy.listAvailable
				? `VidFast proxy list is saved in utils/vidfast-proxies.json. ${proxy.enabled ? 'A proxy will be selected on the next VidFast request.' : 'Enable proxying to select one on the next VidFast request.'}`
				: `Preferred proxy ${proxy.preferredProxy} will be checked first. Download the independent VidFast proxy list for fallback candidates.`;
	} catch(error) {
		status.textContent = `Unable to load VidFast proxy status: ${error.message}`;
	}
}

async function renderVidyProxySettings(enabled = false){
	const checkbox = document.getElementById('vidyProxyEnabled');
	const label = document.getElementById('vidyProxyEnabledLabel');
	const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
	const status = document.getElementById('vidyProxyStatus');
	if(checkbox) {
		checkbox.checked = enabled === true;
		label?.classList.toggle('on', checkbox.checked);
		if(labelText) labelText.textContent = checkbox.checked ? 'Proxy enabled' : 'Enable proxy';
	}
	if(!status) return;
	try {
		const response = await fetch(U('/api/providers/vidy/proxy-status'), { cache:'no-store' });
		const proxy = await response.json();
		if(!response.ok || !proxy.success) throw new Error(proxy.error || `HTTP ${response.status}`);
		status.textContent = proxy.selectedProxy
			? `Selected: ${proxy.selectedProxy}`
			: proxy.listAvailable
				? `Shared list is saved in ${proxy.sharedList}. ${proxy.enabled ? 'A proxy will be selected on the next Vidy request.' : 'Enable proxying to select one on the next Vidy request.'}`
				: `Preferred proxy ${proxy.preferredProxy} will be checked first. Download the shared VidFast proxy list for fallback candidates.`;
	} catch(error) {
		status.textContent = `Unable to load Vidy proxy status: ${error.message}`;
	}
}

async function renderBingebangProxySettings(enabled = false){
	const checkbox = document.getElementById('bingebangProxyEnabled');
	const label = document.getElementById('bingebangProxyEnabledLabel');
	const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
	const status = document.getElementById('bingebangProxyStatus');
	if(checkbox) {
		checkbox.checked = enabled === true;
		label?.classList.toggle('on', checkbox.checked);
		if(labelText) labelText.textContent = checkbox.checked ? 'Proxy enabled' : 'Enable proxy';
	}
	if(!status) return;
	try {
		const response = await fetch(U('/api/providers/bingebang/proxy-status'), { cache:'no-store' });
		const proxy = await response.json();
		if(!response.ok || !proxy.success) throw new Error(proxy.error || `HTTP ${response.status}`);
		status.textContent = proxy.selectedProxy
			? `Selected: ${proxy.selectedProxy}`
			: proxy.listAvailable
				? `Shared list is saved in ${proxy.sharedList}. ${proxy.enabled ? 'A proxy will be selected on the next BingeBang request.' : 'Enable proxying to select one on the next BingeBang request.'}`
				: `Preferred proxy ${proxy.preferredProxy} will be checked first. Download the shared VidFast proxy list for fallback candidates.`;
	} catch(error) {
		status.textContent = `Unable to load BingeBang proxy status: ${error.message}`;
	}
}

async function renderSharedProviderProxySettings(provider, enabled = false){
	const slug = provider.toLowerCase();
	const checkbox = document.getElementById(`${slug}ProxyEnabled`);
	const label = document.getElementById(`${slug}ProxyEnabledLabel`);
	const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
	const status = document.getElementById(`${slug}ProxyStatus`);
	if(checkbox) {
		checkbox.checked = enabled === true;
		label?.classList.toggle('on', checkbox.checked);
		if(labelText) labelText.textContent = checkbox.checked ? 'Proxy enabled' : 'Enable proxy';
	}
	if(!status) return;
	try {
		const response = await fetch(U(`/api/providers/${slug}/proxy-status`), { cache:'no-store' });
		const proxy = await response.json();
		if(!response.ok || !proxy.success) throw new Error(proxy.error || `HTTP ${response.status}`);
		status.textContent = proxy.selectedProxy
			? `Selected: ${proxy.selectedProxy}`
			: proxy.listAvailable
				? `Shared list is saved in ${proxy.sharedList}. ${proxy.enabled ? `A proxy will be selected on the next ${provider} request.` : `Enable proxying to select one on the next ${provider} request.`}`
				: `Preferred proxy ${proxy.preferredProxy} will be checked first. Download the shared VidFast proxy list for fallback candidates.`;
	} catch(error) {
		status.textContent = `Unable to load ${provider} proxy status: ${error.message}`;
	}
}

async function renderVideasyProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Videasy', enabled);
}

async function renderVidloveProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Vidlove', enabled);
}

async function renderSuperstreamProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Superstream', enabled);
}

async function renderBowlerProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Bowler', enabled);
}

async function renderCinesrcProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Cinesrc', enabled);
}

async function renderBarbarianProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Barbarian', enabled);
}

async function renderFrameXTVProxySettings(enabled = false){
	return renderSharedProviderProxySettings('FrameXTV', enabled);
}

async function renderMinerProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Miner', enabled);
}

async function renderTitanProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Titan', enabled);
}

async function renderValkyrieProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Valkyrie', enabled);
}

async function renderVidrockProxySettings(enabled = false){
	return renderSharedProviderProxySettings('Vidrock', enabled);
}

async function downloadProviderProxyList(provider){
	const buttonId = provider === 'MovieBox' ? 'downloadMovieboxProxyListBtn'
		: provider === 'Vidy' ? 'downloadVidyProxyListBtn'
			: provider === 'BingeBang' ? 'downloadBingebangProxyListBtn'
				: provider === 'Videasy' ? 'downloadVideasyProxyListBtn'
					: provider === 'Vidlove' ? 'downloadVidloveProxyListBtn'
						: provider === 'Superstream' ? 'downloadSuperstreamProxyListBtn'
							: provider === 'VidFast' ? 'downloadVidfastProxyListBtn'
								: `download${provider}ProxyListBtn`;
	const button = document.getElementById(buttonId);
	const status = document.getElementById(`${provider.toLowerCase()}ProxyStatus`);
	if(button) button.disabled = true;
	if(status) status.textContent = `Downloading and saving the ${provider} ProxyScrape JSON...`;
	try {
		const response = await fetch(U(`/api/providers/${provider.toLowerCase()}/proxies`), { method:'POST', cache:'no-store' });
		const data = await response.json();
		if(!response.ok || !data.success) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}
		if(status) status.textContent = `Saved ${data.count} proxies to ${data.file} (${data.usableCount} eligible for probing).`;
	} catch(error){
		if(status) status.textContent = `${provider} proxy-list download failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

async function downloadMovieboxProxyList(){
	return downloadProviderProxyList('MovieBox');
}

async function downloadVidfastProxyList(){
	return downloadProviderProxyList('VidFast');
}

async function downloadVidyProxyList(){
	return downloadProviderProxyList('Vidy');
}

async function downloadBingebangProxyList(){
	return downloadProviderProxyList('BingeBang');
}

async function downloadVideasyProxyList(){
	return downloadProviderProxyList('Videasy');
}

async function downloadVidloveProxyList(){
	return downloadProviderProxyList('Vidlove');
}

async function downloadSuperstreamProxyList(){
	return downloadProviderProxyList('Superstream');
}

async function downloadVidrockProxyList(){
	return downloadProviderProxyList('Vidrock');
}

async function saveMovieboxProxySettings(){
	const button = document.getElementById('saveMovieboxProxySettingsBtn');
	const status = document.getElementById('movieboxProxySettingsStatus');
	if(button) button.disabled = true;
	if(status) status.textContent = 'Saving...';
	try {
		const response = await fetch(U('/api/providers/moviebox/settings'), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ settings:{ proxy_enabled:document.getElementById('movieboxProxyEnabled').checked } })
		});
		const data = await response.json();
		if(!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
		await renderMovieboxSettings(data.settings);
		await reloadLiveOnly();
		if(status) status.textContent = 'MovieBox connection saved to user-config.json and .env';
	} catch(error) {
		if(status) status.textContent = `Save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

async function saveVidfastProxySettings(){
	const button = document.getElementById('saveVidfastProxySettingsBtn');
	const status = document.getElementById('vidfastProxySettingsStatus');
	if(button) button.disabled = true;
	if(status) status.textContent = 'Saving...';
	try {
		const enabled = document.getElementById('vidfastProxyEnabled').checked;
		const response = await fetch(U('/api/providers/vidfast/proxy-settings'), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ enabled })
		});
		const data = await response.json();
		if(!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
		await renderVidfastProxySettings(data.enabled);
		await reloadLiveOnly();
		if(status) status.textContent = 'VidFast connection saved to user-config.json';
	} catch(error) {
		if(status) status.textContent = `Save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

async function saveVidyProxySettings(){
	const button = document.getElementById('saveVidyProxySettingsBtn');
	const status = document.getElementById('vidyProxySettingsStatus');
	if(button) button.disabled = true;
	if(status) status.textContent = 'Saving...';
	try {
		const enabled = document.getElementById('vidyProxyEnabled').checked;
		const response = await fetch(U('/api/providers/vidy/proxy-settings'), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ enabled })
		});
		const data = await response.json();
		if(!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
		await renderVidyProxySettings(data.enabled);
		await reloadLiveOnly();
		if(status) status.textContent = 'Vidy connection saved to user-config.json';
	} catch(error) {
		if(status) status.textContent = `Save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

async function saveBingebangProxySettings(){
	const button = document.getElementById('saveBingebangProxySettingsBtn');
	const status = document.getElementById('bingebangProxySettingsStatus');
	if(button) button.disabled = true;
	if(status) status.textContent = 'Saving...';
	try {
		const enabled = document.getElementById('bingebangProxyEnabled').checked;
		const response = await fetch(U('/api/providers/bingebang/proxy-settings'), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ enabled })
		});
		const data = await response.json();
		if(!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
		await renderBingebangProxySettings(data.enabled);
		await reloadLiveOnly();
		if(status) status.textContent = 'BingeBang connection saved to user-config.json';
	} catch(error) {
		if(status) status.textContent = `Save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

async function saveSharedProviderProxySettings(provider){
	const slug = provider.toLowerCase();
	const button = document.getElementById(`save${provider}ProxySettingsBtn`);
	const status = document.getElementById(`${slug}ProxySettingsStatus`);
	if(button) button.disabled = true;
	if(status) status.textContent = 'Saving...';
	try {
		const enabled = document.getElementById(`${slug}ProxyEnabled`).checked;
		const response = await fetch(U(`/api/providers/${slug}/proxy-settings`), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ enabled })
		});
		const data = await response.json();
		if(!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
		await renderSharedProviderProxySettings(provider, data.enabled);
		await reloadLiveOnly();
		if(status) status.textContent = `${provider} connection saved to user-config.json`;
	} catch(error) {
		if(status) status.textContent = `Save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

async function saveVideasyProxySettings(){
	return saveSharedProviderProxySettings('Videasy');
}

async function saveVidloveProxySettings(){
	return saveSharedProviderProxySettings('Vidlove');
}

async function saveSuperstreamProxySettings(){
	return saveSharedProviderProxySettings('Superstream');
}

async function saveBowlerProxySettings(){ return saveSharedProviderProxySettings('Bowler'); }
async function saveCinesrcProxySettings(){ return saveSharedProviderProxySettings('Cinesrc'); }
async function saveBarbarianProxySettings(){ return saveSharedProviderProxySettings('Barbarian'); }
async function saveFrameXTVProxySettings(){ return saveSharedProviderProxySettings('FrameXTV'); }
async function saveMinerProxySettings(){ return saveSharedProviderProxySettings('Miner'); }
async function saveTitanProxySettings(){ return saveSharedProviderProxySettings('Titan'); }
async function saveValkyrieProxySettings(){ return saveSharedProviderProxySettings('Valkyrie'); }
async function saveVidrockProxySettings(){ return saveSharedProviderProxySettings('Vidrock'); }

async function saveMovieboxSettings(){
	const button = document.getElementById('saveMovieboxSettingsBtn');
	const status = document.getElementById('movieboxSettingsStatus');
	if(button) button.disabled = true;
	if(status) status.textContent = 'Saving...';
	const settings = {};
	document.querySelectorAll('[data-moviebox-setting]').forEach(input=>{
		settings[input.dataset.movieboxSetting] = input.checked;
	});
	try {
		const response = await fetch(U('/api/providers/moviebox/settings'), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ settings })
		});
		const data = await response.json();
		if(!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
		await renderMovieboxSettings(data.settings || settings);
		await reloadLiveOnly();
		if(status) status.textContent = 'Saved to .env and user-config.json';
	} catch(error){
		if(status) status.textContent = `Save failed: ${error.message}`;
	} finally {
		if(button) button.disabled = false;
	}
}

function setFebboxCookies(cookiesArray){
	const listEl = document.getElementById('febboxCookieList');
	const hidden = document.querySelector('input[name="febboxCookiesHidden"]');
	if(!listEl || !hidden) return;
	const arr = Array.isArray(cookiesArray)? cookiesArray.filter(c=>c && typeof c==='string') : [];
	hidden.value = arr.join(',');
	listEl.innerHTML = arr.length? arr.map((c,i)=>`<div class="cookie-item" data-idx="${i}"><code>${c}</code><button type="button" class="remove" title="Remove" data-action="rm" data-idx="${i}">✕</button></div>`).join('') : '<div class="empty">No cookies added</div>';
}
function addFebboxCookie(){
	const input = document.getElementById('febboxCookieInput');
	const val = (input.value||'').trim();
	if(!val) return;
	const hidden = document.querySelector('input[name="febboxCookiesHidden"]');
	const existing = hidden.value? hidden.value.split(',').filter(Boolean):[];
	if(existing.includes(val)) { input.value=''; return; }
	existing.push(val);
	setFebboxCookies(existing);
	input.value='';
	validate();
}
function removeFebboxCookie(idx){
	const hidden = document.querySelector('input[name="febboxCookiesHidden"]');
	const existing = hidden.value? hidden.value.split(',').filter(Boolean):[];
	const next = existing.filter((_,i)=> i!=idx);
	setFebboxCookies(next);
	validate();
}
document.addEventListener('click', (e)=>{
	const btn = e.target.closest('#addFebboxCookieBtn');
	if(btn){ addFebboxCookie(); }
	const rm = e.target.closest('.cookie-item button.remove');
	if(rm){ const idx = rm.dataset.idx; removeFebboxCookie(idx); }
});
document.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && e.target.id==='febboxCookieInput'){ e.preventDefault(); addFebboxCookie(); }});

// TMDB multi-key management
function setTmdbKeys(keys){
	const listEl = document.getElementById('tmdbKeyList');
	const hidden = document.querySelector('input[name="tmdbApiKeysHidden"]');
	if(!listEl || !hidden) return;
	const arr = Array.isArray(keys)? keys.filter(k=>k && typeof k==='string') : [];
	hidden.value = arr.join(',');
	listEl.innerHTML = arr.length? arr.map((k,i)=>`<div class="key-item" data-idx="${i}"><code>${k}</code><button type="button" class="remove" data-action="rm-tmdb" data-idx="${i}" title="Remove">✕</button></div>`).join('') : '<div class="empty">No TMDB keys</div>';
}
function addTmdbKey(){
	const input = document.getElementById('tmdbKeyInput');
	const val = (input.value||'').trim();
	if(!val) return;
	const hidden = document.querySelector('input[name="tmdbApiKeysHidden"]');
	const existing = hidden.value? hidden.value.split(',').filter(Boolean):[];
	if(existing.includes(val)) { input.value=''; return; }
	existing.push(val);
	setTmdbKeys(existing);
	input.value='';
	validate();
}
function removeTmdbKey(idx){
	const hidden = document.querySelector('input[name="tmdbApiKeysHidden"]');
	const existing = hidden.value? hidden.value.split(',').filter(Boolean):[];
	setTmdbKeys(existing.filter((_,i)=> i!=idx));
	validate();
}
document.addEventListener('click',(e)=>{
	if(e.target.closest('#addTmdbKeyBtn')) addTmdbKey();
	const rm = e.target.closest('.key-item button.remove');
	if(rm){ removeTmdbKey(rm.dataset.idx); }
});
document.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && e.target.id==='tmdbKeyInput'){ e.preventDefault(); addTmdbKey(); }});

// --- Stream API token ---
const REDACTED_TOKEN = '(set — admin session required)';
	function currentStreamTokenHash(){
		const display = document.getElementById('streamTokenDisplay');
		const value = (display && display.value || '').trim();
		// The server redacts the hash for non-admins; never treat the redaction marker as a real token
		return /^[0-9a-f]{64}$/.test(value) ? value : null;
	}
	let providerTestName = '';
	let providerTestCategory = 'MoviesTv';
	function closeProviderTestDialog(){
		const modal = document.getElementById('providerTestModal');
		if(modal){ modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); }
		providerTestName = '';
		providerTestCategory = 'MoviesTv';
	}
	function openProviderTestDialog(providerName, category){
		const modal = document.getElementById('providerTestModal');
		const title = document.getElementById('providerTestTitle');
		const movieBtn = document.getElementById('testProviderMovieBtn');
		const tvBtn = document.getElementById('testProviderTvBtn');
		if(!modal) return;
		providerTestName = providerName;
		providerTestCategory = category === 'Anime' ? 'Anime' : 'MoviesTv';
		if(title) title.textContent = `Test ${providerName}`;
		if(movieBtn) movieBtn.textContent = providerTestCategory === 'Anime' ? 'Anime movie · TMDB 372058' : 'Movie · TMDB 550';
		if(tvBtn) tvBtn.textContent = providerTestCategory === 'Anime' ? 'Anime TV · TMDB 1429 S01E04' : 'TV · TMDB 1622 S01E04';
		modal.classList.add('show');
		modal.setAttribute('aria-hidden','false');
	}
	function openProviderTestUrl(mediaType){
		if(!providerTestName) return;
		const isAnime = providerTestCategory === 'Anime';
		const path = isAnime
			? (mediaType === 'tv'
				? `/api/streams/${encodeURIComponent(providerTestName)}/anime/1429?season=1&episode=4`
				: `/api/streams/${encodeURIComponent(providerTestName)}/anime/372058`)
			: (mediaType === 'tv'
				? `/api/streams/${encodeURIComponent(providerTestName)}/series/1622?season=1&episode=4`
				: `/api/streams/${encodeURIComponent(providerTestName)}/movie/550`);
		const url = new URL(U(path), window.location.origin);
		const token = currentStreamTokenHash();
		if(token) url.searchParams.set('token', token);
		closeProviderTestDialog();
		window.open(url.href, '_blank', 'noopener,noreferrer');
	}
	document.addEventListener('click',(e)=>{
		if(e.target.closest('#testProviderMovieBtn')) openProviderTestUrl('movie');
		if(e.target.closest('#testProviderTvBtn')) openProviderTestUrl('tv');
		if(e.target.closest('#cancelProviderTestBtn') || e.target.closest('#providerTestModal .modal-backdrop')) closeProviderTestDialog();
	});
	document.addEventListener('keydown',(e)=>{ if(e.key === 'Escape') closeProviderTestDialog(); });
	function renderStreamToken(hash){
	const display = document.getElementById('streamTokenDisplay');
	const example = document.getElementById('streamTokenExample');
	const state = document.getElementById('streamTokenState');
	const copyBtn = document.getElementById('copyStreamTokenBtn');
	const disableBtn = document.getElementById('disableStreamTokenBtn');
	const has = typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
	if (display) display.value = typeof hash === 'string' ? hash : '';
	if (example) example.textContent = has ? `?token=${hash}` : '?token=...';
	if (state) state.textContent = has
		? 'Stream endpoints require this token via ?token=.'
		: 'Stream endpoints are currently open — no token required.';
	if (copyBtn) copyBtn.disabled = !has;
	if (disableBtn) disableBtn.disabled = !has;
}
async function updateStreamToken(){
	const input = document.getElementById('streamTokenInput');
	if (!input) return;
	const password = (input.value || '').trim();
	if (!password) { setStatus('Enter a token password first', true); return; }
	if (!/^[A-Za-z0-9]{8,64}$/.test(password)) {
		setStatus('Token password must be 8-64 letters or numbers only', true);
		return;
	}
	const btn = document.getElementById('updateStreamTokenBtn');
	if (btn) btn.disabled = true;
	try {
		const r = await fetch(U('/api/stream-token'), {
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({ password })
		});
		const js = await r.json();
		if (!r.ok || !js.success) throw new Error(js.message || js.error || 'Update failed');
		renderStreamToken(js.streamTokenHash);
		input.value = '';
		setStatus('Token updated ✔');
	} catch(e){ setStatus(e.message, true); }
	finally { if (btn) btn.disabled = false; }
}
async function disableStreamToken(){
	const btn = document.getElementById('disableStreamTokenBtn');
	if (btn) btn.disabled = true;
	try {
		const r = await fetch(U('/api/stream-token'), { method:'DELETE' });
		const js = await r.json();
		if (!r.ok || !js.success) throw new Error(js.error || 'Disable failed');
		renderStreamToken(null);
		setStatus('Stream auth disabled');
	} catch(e){
		setStatus(e.message, true);
		// Re-render from the current value so the buttons reflect real state
		renderStreamToken(currentStreamTokenHash());
	}
}
async function copyStreamToken(){
	const hash = currentStreamTokenHash();
	if (!hash) { setStatus('No token set', true); return; }
	try {
		await navigator.clipboard.writeText(hash);
		setStatus('Token copied ✔');
	} catch(e){
		// Clipboard API needs a secure context; fall back to selecting the text
		const display = document.getElementById('streamTokenDisplay');
		if (display) { display.select(); display.setSelectionRange(0, display.value.length); }
		setStatus('Press Ctrl+C to copy the selected token', true);
	}
}
document.addEventListener('click',(e)=>{
	if (e.target.closest('#updateStreamTokenBtn')) updateStreamToken();
	if (e.target.closest('#copyStreamTokenBtn')) copyStreamToken();
	if (e.target.closest('#disableStreamTokenBtn')) disableStreamToken();
	if (e.target.closest('#saveProviderCheckSeriesBtn')) saveProviderCheckSeries();
});
document.addEventListener('change',(e)=>{
	if (e.target.id === 'providerCheckType') applyProviderCheckMode();
});
document.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && e.target.id==='streamTokenInput'){ e.preventDefault(); updateStreamToken(); }});

function fillForm(data){
	const merged = data.merged || {};
	const override = data.override || {};
	renderMovieboxSettings(merged.movieboxSettings || {});
	renderVidfastProxySettings(merged.vidfastProxyEnabled === true);
	renderVidyProxySettings(merged.vidyProxyEnabled === true);
	renderBingebangProxySettings(merged.bingebangProxyEnabled === true);
	renderVideasyProxySettings(merged.videasyProxyEnabled === true);
	renderVidloveProxySettings(merged.vidloveProxyEnabled === true);
	renderSuperstreamProxySettings(merged.superstreamProxyEnabled === true);
	renderBowlerProxySettings(merged.bowlerProxyEnabled === true);
	renderCinesrcProxySettings(merged.cinesrcProxyEnabled === true);
	renderBarbarianProxySettings(merged.barbarianProxyEnabled === true);
	renderFrameXTVProxySettings(merged.framextvProxyEnabled === true);
	renderMinerProxySettings(merged.minerProxyEnabled === true);
	renderTitanProxySettings(merged.titanProxyEnabled === true);
	renderValkyrieProxySettings(merged.valkyrieProxyEnabled === true);
	renderVidrockProxySettings(merged.vidrockProxyEnabled === true);
	const f = document.getElementById('cfgForm');
	const fields = ['port'];
	fields.forEach(k=>{ if(!f.elements[k]) return; const ov = override[k]; f.elements[k].value = ov !== undefined ? ov : (merged[k]||''); });
	if (f.elements['defaultRegion']) {
		const val = override.defaultRegion !== undefined ? override.defaultRegion : (merged.defaultRegion || '');
		f.elements['defaultRegion'].value = val || '';
	}
	f.elements['defaultProviders'].value = (override.defaultProviders || merged.defaultProviders || []).join(',');
	(function(){
		let cookiesVal = override.febboxCookies || merged.febboxCookies || [];
		if(typeof cookiesVal === 'string') {
			const trimmed = cookiesVal.trim();
			if(trimmed.startsWith('[') && trimmed.endsWith(']')) { try { const arr = JSON.parse(trimmed); if(Array.isArray(arr)) cookiesVal = arr; } catch{} }
			else if (trimmed.includes(',') || trimmed.includes('\n') || trimmed.includes(';')) {
				cookiesVal = trimmed.split(/[\n;,]+/).map(s=>s.trim()).filter(Boolean);
			} else if(trimmed) cookiesVal = [trimmed]; else cookiesVal = [];
		}
		if(!Array.isArray(cookiesVal)) cookiesVal = [];
		setFebboxCookies(cookiesVal);
	})();
	(function(){
		let keys = override.tmdbApiKeys || merged.tmdbApiKeys || [];
		if(!Array.isArray(keys)) {
			if (override.tmdbApiKey) keys = [override.tmdbApiKey];
			else if (merged.tmdbApiKey) keys = [merged.tmdbApiKey];
			else keys = [];
		}
		setTmdbKeys(keys);
	})();
	(function(){
		const tokenHash = override.streamTokenHash !== undefined ? override.streamTokenHash : merged.streamTokenHash;
		renderStreamToken(typeof tokenHash === 'string' ? tokenHash : null);
	})();
	const mqRaw = override.minQualitiesRaw !== undefined ? override.minQualitiesRaw : (merged.minQualitiesRaw || '');
	const presetValues = ['all','480p','720p','1080p','1440p','2160p'];
	let matchedPreset = presetValues.includes((mqRaw||'').toLowerCase()) ? mqRaw.toLowerCase() : (mqRaw? 'custom':'all');
	const presetInput = document.querySelector(`input[name="qualityPreset"][value="${matchedPreset}"]`) || document.querySelector('input[name="qualityPreset"][value="all"]');
	if (presetInput) presetInput.checked = true;
	const customField = document.querySelector('textarea[name="minQualitiesRaw"]');
	if (customField) {
		if (matchedPreset === 'custom') { customField.disabled = false; customField.value = mqRaw; }
		else { customField.disabled = true; customField.value = ''; }
	}
	const excRaw = override.excludeCodecsRaw !== undefined ? override.excludeCodecsRaw : (merged.excludeCodecsRaw || '');
	let parsed = null; try { if(excRaw && /[\{\[]/.test(excRaw)) parsed = JSON.parse(excRaw); } catch {}
	let mode = 'none';
	if(parsed){
		const dv = parsed.excludeDV === true;
		const hdr = parsed.excludeHDR === true;
		if(!dv && !hdr) mode = 'none';
		else if(dv && hdr) mode = 'all';
		else if(dv && !hdr) mode = 'dv';
		else if(hdr && !dv) mode = 'hdr';
		else mode = 'advanced';
	} else if(excRaw){
		if(/excludeDV":true/.test(excRaw) && !/excludeHDR":true/.test(excRaw)) mode='dv';
		else if(/excludeHDR":true/.test(excRaw) && !/excludeDV":true/.test(excRaw)) mode='hdr';
		else mode='advanced';
	}
	const presetInputC = document.querySelector(`input[name="codecPreset"][value="${mode}"]`) || document.querySelector('input[name="codecPreset"][value="all"]');
	if(presetInputC) presetInputC.checked = true;
	const codecTa = document.querySelector('textarea[name="excludeCodecsRaw"]');
	if(mode==='advanced') { codecTa.disabled=false; codecTa.value = excRaw || JSON.stringify({excludeDV:false,excludeHDR:false}); }
	else { codecTa.disabled=true; codecTa.value=''; }
	document.getElementById('currentCfg').textContent = JSON.stringify(merged, null, 2);
	document.getElementById('overrideCfg').textContent = Object.keys(override).length? JSON.stringify(override,null,2): '(none)';
	document.getElementById('bootWarn').style.display = (!merged.febboxCookies || merged.febboxCookies.length===0)? 'block':'none';
	// Removed version & overrides pills from UI; logic deleted
	const cacheBanner = document.getElementById('cacheDisabledBanner'); if(cacheBanner) cacheBanner.style.display = merged.disableCache? 'block':'none';
	const tmdbBanner = document.getElementById('tmdbMissingBanner');
	if(tmdbBanner){
		const tmdbMissing = !((override.tmdbApiKeys && override.tmdbApiKeys.length) || (merged.tmdbApiKeys && merged.tmdbApiKeys.length) || override.tmdbApiKey || merged.tmdbApiKey);
		const tmdbProvidersEnabled = [
			merged.enableShowboxProvider !== false,
			merged.enable4khdhubProvider !== false
		].some(Boolean);
		tmdbBanner.style.display = (tmdbMissing && tmdbProvidersEnabled)? 'block':'none';
	}
	const advBools = [
		['enable4khdhubProvider','adv_enable4khdhub'],
		['enableVixsrcProvider','adv_enableVixsrc'],
		['enableProxy','adv_enableProxy'],
		['disableCache','adv_disableCache'],
		['enablePStreamApi','adv_enablePStream'],
		['disableUrlValidation','adv_disableUrlValidation'],
		['disable4khdhubUrlValidation','adv_disable4khdhubValidation']
	];
	advBools.forEach(([cfgKey, elName])=>{ const el = f.elements[elName]; if(!el) return; const src = (override[cfgKey]!==undefined? override[cfgKey] : merged[cfgKey]); if(el.type==='checkbox'){ el.checked = !!src; } else { el.value = src? 'true':''; } });
	const advTexts = [
	['showboxCacheDir','adv_showboxCacheDir']
	];
	advTexts.forEach(([cfgKey, elName])=>{ const el = f.elements[elName]; if(!el) return; const val = override[cfgKey]!==undefined? override[cfgKey] : merged[cfgKey]; el.value = val || ''; });
	// Sync checkbox style advanced flags
	const advFlagMap = {
		adv_disableCache: 'disableCache',
		adv_disableUrlValidation: 'disableUrlValidation',
		adv_disable4khdhubValidation: 'disable4khdhubUrlValidation'
	};
	Object.entries(advFlagMap).forEach(([inputName, cfgKey]) => {
		const el = f.elements[inputName];
		if(!el) return;
		const val = override[cfgKey] !== undefined ? override[cfgKey] : merged[cfgKey];
		el.checked = !!val;
	});
}

async function reload(){
	try {
		const data = await fetchConfig();
		fillForm(data);
		renderProviderMatrix(data.merged);
		validate();
		setStatus('');
	} catch(e){ setStatus('Load failed: '+e.message,true); }
}

function setStatus(msg, isErr){
	const el = document.getElementById('status');
	el.textContent = msg;
	el.style.color = isErr? '#dc2626':'inherit';
}

async function save(){
	const f = document.getElementById('cfgForm');
	const payload = {};
	const dp = f.elements['defaultProviders'].value.trim();
	if (dp) payload.defaultProviders = dp.split(/[\s,]+/).filter(Boolean);
	['port'].forEach(k=>{
		if(!f.elements[k]) return;
		const v = f.elements[k].value.trim();
		payload[k] = v? v : null;
	});
	const selPreset = document.querySelector('input[name="qualityPreset"]:checked');
	if (selPreset) {
		if (selPreset.value === 'custom') {
			const cv = f.elements['minQualitiesRaw'].value.trim();
			if (cv) payload.minQualitiesRaw = cv; else payload.minQualitiesRaw = null;
		} else {
			payload.minQualitiesRaw = selPreset.value === 'all' ? 'all' : selPreset.value;
		}
	}
	const cPreset = document.querySelector('input[name="codecPreset"]:checked');
	if(cPreset){
		if(cPreset.value==='none') payload.excludeCodecsRaw = JSON.stringify({excludeDV:false,excludeHDR:false});
		else if(cPreset.value==='all') payload.excludeCodecsRaw = JSON.stringify({excludeDV:true,excludeHDR:true});
		else if(cPreset.value==='dv') payload.excludeCodecsRaw = JSON.stringify({excludeDV:true,excludeHDR:false});
		else if(cPreset.value==='hdr') payload.excludeCodecsRaw = JSON.stringify({excludeDV:false,excludeHDR:true});
		else if(cPreset.value==='advanced') {
			const raw = document.querySelector('textarea[name="excludeCodecsRaw"]').value.trim();
			payload.excludeCodecsRaw = raw || null;
		}
	}
	const drSel = f.elements['defaultRegion'];
	if (drSel) payload.defaultRegion = drSel.value ? drSel.value : null;
	const cookiesHidden = f.elements['febboxCookiesHidden'];
	if(cookiesHidden){
		const cookiesVal = cookiesHidden.value.trim();
		payload.febboxCookies = cookiesVal? cookiesVal.split(',').filter(Boolean) : [];
	}
	const boolMap = {
		adv_enable4khdhub:'enable4khdhubProvider',
		adv_enableVixsrc:'enableVixsrcProvider',
		adv_enableProxy:'enableProxy',
		adv_disableCache:'disableCache',
		adv_enablePStream:'enablePStreamApi',
		adv_disableUrlValidation:'disableUrlValidation',
		adv_disable4khdhubValidation:'disable4khdhubUrlValidation'
	};
	Object.entries(boolMap).forEach(([formName,cfgKey])=>{ const el = f.elements[formName]; if(el) payload[cfgKey] = !!el.checked; });
	const textMap = { adv_showboxCacheDir:'showboxCacheDir' };
	Object.entries(textMap).forEach(([formName,cfgKey])=>{ const el = f.elements[formName]; if(!el) return; const v = el.value.trim(); payload[cfgKey] = v? v : null; });
	const tmdbHidden = f.elements['tmdbApiKeysHidden'];
	if (tmdbHidden){
		const raw = tmdbHidden.value.trim();
		payload.tmdbApiKeys = raw? raw.split(',').filter(Boolean) : [];
		payload.tmdbApiKey = null;
	}
	try {
		const r = await fetch(U('/api/config'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
		const js = await r.json();
		if(!js.success) throw new Error(js.error||'Save failed');
		setStatus('Saved ✔');
		fillForm(js);
	} catch(e){ setStatus(e.message,true); }
}

function openConfirmReset(){
	const modal = document.getElementById('confirmReset');
	if(!modal) return Promise.resolve(false);
	// Respect persisted preference
	try {
		const skip = localStorage.getItem('ns_confirmReset_skip') === '1';
		if (skip) return Promise.resolve(true);
	} catch {}
	modal.classList.add('show');
	return new Promise(resolve => {
		const onClick = (e)=>{
			const action = e.target?.dataset?.action;
			if(action==='confirm'){
				try {
					const dontAsk = modal.querySelector('#confirmResetDontAsk')?.checked;
					if (dontAsk) localStorage.setItem('ns_confirmReset_skip','1');
				} catch {}
				cleanup(); resolve(true);
			}
			if(action==='cancel' || e.target===modal.querySelector('.modal-backdrop')){ cleanup(); resolve(false); }
		};
		function onKey(e){ if(e.key==='Escape'){ cleanup(); resolve(false); } }
		function cleanup(){ modal.classList.remove('show'); modal.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); }
		modal.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
	});
}

function openConfirmRestart(){
	const modal = document.getElementById('confirmRestart');
	if(!modal) return Promise.resolve(false);
	modal.classList.add('show');
	return new Promise(resolve => {
		const onClick = (e)=>{
			const action = e.target?.dataset?.action;
			if(action==='confirm'){ cleanup(); resolve(true); }
			if(action==='cancel' || e.target===modal.querySelector('.modal-backdrop')){ cleanup(); resolve(false); }
		};
		function onKey(e){ if(e.key==='Escape'){ cleanup(); resolve(false); } }
		function cleanup(){ modal.classList.remove('show'); modal.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); }
		modal.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
	});
}

async function clearAll(){
	const confirmed = await openConfirmReset();
	if(!confirmed) return;
	// To truly reset to app defaults, we must:
	// - Explicitly clear arrays so env fallbacks don't persist
	// - Set boolean flags to their default values (rather than null)
	// - Null legacy single TMDB key
	const payload = {
		port: null,
		defaultRegion: null,
		defaultProviders: [],
		minQualitiesRaw: 'all',
		excludeCodecsRaw: JSON.stringify({excludeDV:false,excludeHDR:false}),
		// Explicit empty arrays ensure override wins over any prior env mirror
		febboxCookies: [],
		tmdbApiKeys: [],
		tmdbApiKey: null,
		// Provider enable flags default to true
		enableShowboxProvider: true,
		enable4khdhubProvider: true,
		enableVixsrcProvider: true,
		enableProxy: false,
		// Other defaults
		disableCache: false,
		enablePStreamApi: true,
		disableUrlValidation: false,
		disable4khdhubUrlValidation: false,
		showboxCacheDir: null,
		providerCheckTmdbId: null,
		animeProviderCheckTmdbId: null,
		providerCheckType: null,
		providerCheckSeriesTmdbId: null,
		providerCheckSeason: null,
		providerCheckEpisode: null,
		movieboxSettings: {
			subtitles: true,
			all_audio_tracks: true,
			hardsub_tracks: true,
			debug_logs: true,
			res_2160p: true,
			res_1440p: true,
			res_1080p: true,
			res_720p: true,
			res_480p: true,
			res_360p: true
		},
		vidfastProxyEnabled: false,
		vidyProxyEnabled: false,
		bingebangProxyEnabled: false,
		videasyProxyEnabled: false,
		vidloveProxyEnabled: false,
		superstreamProxyEnabled: false,
		bowlerProxyEnabled: false,
		cinesrcProxyEnabled: false,
		barbarianProxyEnabled: false,
		framextvProxyEnabled: false,
		minerProxyEnabled: false,
		titanProxyEnabled: false,
		valkyrieProxyEnabled: false,
		// Stream auth returns to "disabled" (env may still supply a hash)
		streamTokenHash: null
	};
	try {
		const r = await fetch(U('/api/config'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
		const js = await r.json();
		if(!js.success) throw new Error(js.error||'Clear failed');
		setStatus('All settings reset to defaults');
		fillForm(js);
		// Re-render provider matrix immediately so toggles reflect defaults without page refresh
		try { renderProviderMatrix(js.merged); } catch {}
		validate();
	} catch(e){ setStatus(e.message,true); }
}

function setTheme(t){
	document.documentElement.dataset.theme = t;
	document.documentElement.dataset.bsTheme = t;
	localStorage.setItem('ns_theme', t);
}
function initTheme(){
	const saved = localStorage.getItem('ns_theme');
	setTheme(saved || 'dark');
}
function toggleTheme(){
	setTheme(document.documentElement.dataset.theme === 'dark' ? 'light':'dark');
}
function navTo(id){
document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active', p.id===id));
document.querySelectorAll('.nav-item').forEach(a=>a.classList.toggle('active', a.dataset.target===id));
if(history.replaceState) history.replaceState(null,'', '#'+id);
if(id==='panel-status') loadServerStatus();
if(id==='panel-logs') startConsoleLogPolling();
else stopConsoleLogPolling();
}
function attachCoreListeners(){
	const saveBtn = document.getElementById('saveBtn');
	const reloadBtn = document.getElementById('reloadBtn');
	const clearBtn = document.getElementById('clearBtn');
	if(saveBtn) saveBtn.addEventListener('click', save);
	if(reloadBtn) reloadBtn.addEventListener('click', reload);
	if(clearBtn) clearBtn.addEventListener('click', clearAll);
}
function bindNavigation(){
	document.querySelectorAll('.nav .nav-item[data-target]').forEach(btn=>{
		btn.addEventListener('click', ()=> navTo(btn.dataset.target));
	});
	const themeBtn = document.querySelector('.nav .theme-toggle');
	if(themeBtn) themeBtn.addEventListener('click', toggleTheme);
}
function bindShellControls(){
	const burger = document.querySelector('.burger');
	if(burger) burger.addEventListener('click', ()=> toggleSidebar());
	const overlay = document.querySelector('.overlay');
	if(overlay) overlay.addEventListener('click', ()=> toggleSidebar(false));
}
async function verifySession(){
	try {
		const r = await fetch(U('/auth/session'),{cache:'no-store'});
		const j = await r.json();
		if(!j.authenticated){ location.replace(U('/?expired=1')); }
	} catch { location.replace(U('/?expired=1')); }
}

async function loadServerStatus(){
	const metricsEl = document.getElementById('statusMetrics');
	const endpointsEl = document.getElementById('statusEndpoints');
	const provEnhanced = document.getElementById('statusProvidersEnhanced');
	if(!metricsEl) return;
	metricsEl.textContent = 'Loading...';
	if(endpointsEl) endpointsEl.textContent = 'Loading...';
	if(provEnhanced) provEnhanced.innerHTML = '<div class="prov-row">Loading...</div>';
	try {
		const r = await fetch(U('/api/status'));
		if(!r.ok) throw new Error('Status fetch failed');
		const j = await r.json();
		if(!j.success) throw new Error('Status error');
		metricsEl.textContent = JSON.stringify(j.metrics, null, 2);
		const checkTmdbEl = document.getElementById('providerCheckTmdbId');
		if(checkTmdbEl) checkTmdbEl.value = j.providerCheckTmdbId || '278';
		const typeEl = document.getElementById('providerCheckType');
		if(typeEl && document.activeElement !== typeEl) typeEl.value = j.providerCheckType === 'series' ? 'series' : 'movie';
		const seriesIdEl = document.getElementById('providerCheckSeriesTmdbId');
		if(seriesIdEl && document.activeElement !== seriesIdEl) seriesIdEl.value = j.providerCheckSeriesTmdbId || '1396';
		const seasonEl = document.getElementById('providerCheckSeason');
		if(seasonEl && document.activeElement !== seasonEl) seasonEl.value = j.providerCheckSeason || '1';
		const episodeEl = document.getElementById('providerCheckEpisode');
		if(episodeEl && document.activeElement !== episodeEl) episodeEl.value = j.providerCheckEpisode || '1';
		if(typeof applyProviderCheckMode === 'function') applyProviderCheckMode();
		const animeCheckTmdbEl = document.getElementById('animeProviderCheckTmdbId');
		if(animeCheckTmdbEl && document.activeElement !== animeCheckTmdbEl) animeCheckTmdbEl.value = j.animeProviderCheckTmdbId || '1363974';
		if(endpointsEl) endpointsEl.textContent = (j.endpoints||[]).join('\n');
		if(provEnhanced){
			provEnhanced.innerHTML = '';
			const header = document.createElement('div');
			header.className='prov-row header';
			header.innerHTML = '<span>Name</span><span>Enabled</span><span>Cookie Req</span><span>Cookie OK</span><span>Functional</span><span>Notes</span>';
			provEnhanced.appendChild(header);
			j.providers.forEach(p=>{
				const row = document.createElement('div');
				row.className = 'prov-row';
				row.dataset.provider = p.name;
				row.dataset.category = p.category || 'MoviesTv';
				row.innerHTML = `<strong>${p.name}</strong>`+
					`<span class="badge ${p.enabled? 'ok':'off'}">${p.enabled? 'on':'off'}</span>`+
					`<span class="badge ${p.cookieRequired? 'warn':'off'}">${p.cookieRequired? 'yes':'no'}</span>`+
					`<span class="badge ${p.cookieOk? 'ok':'fail'}">${p.cookieOk? 'ok':'missing'}</span>`+
					`<span class="badge" data-role="functional" title="Run provider checks first">?</span>`+
					`<span class="notes" data-role="notes"></span>`;
				provEnhanced.appendChild(row);
			});
		}
	} catch(e){
		metricsEl.textContent = 'Failed: '+e.message;
		if(endpointsEl) endpointsEl.textContent = 'n/a';
		if(provEnhanced) provEnhanced.innerHTML = '<div class="prov-row">Status load failed</div>';
	}
}
let providerChecksRunning = false;
async function readStreamCheckResponse(response){
	const body = await response.text();
	let data;
	try { data = JSON.parse(body); } catch {}
	if(!response.ok || (data && data.success === false)){
		const detail = data && (data.message || data.error);
		const fallback = body.trim().startsWith('<') ? response.statusText : body.trim();
		throw new Error(`HTTP ${response.status}: ${detail || fallback || 'Stream request failed'}`);
	}
	if(!data) throw new Error('Invalid JSON response from stream endpoint');
	return data;
}
// --- MoviesTv provider check: movie vs TV episode ---
function applyProviderCheckMode(){
	const typeEl = document.getElementById('providerCheckType');
	const movieRow = document.getElementById('providerCheckMovieRow');
	const seriesRow = document.getElementById('providerCheckSeriesRow');
	const hint = document.getElementById('providerCheckTypeHint');
	const isSeries = typeEl && typeEl.value === 'series';
	if(movieRow) movieRow.style.display = isSeries ? 'none' : 'flex';
	if(seriesRow) seriesRow.style.display = isSeries ? 'flex' : 'none';
	if(hint) hint.textContent = isSeries
		? 'TV show used to check MoviesTv providers (e.g. 1396 = Breaking Bad).'
		: 'Movie used to check MoviesTv providers (e.g. 278 = Shawshank Redemption).';
}
function readProviderCheckTarget(){
	const typeEl = document.getElementById('providerCheckType');
	if(typeEl && typeEl.value === 'series'){
		const idEl = document.getElementById('providerCheckSeriesTmdbId');
		const seasonEl = document.getElementById('providerCheckSeason');
		const episodeEl = document.getElementById('providerCheckEpisode');
		return {
			type: 'series',
			id: (idEl && idEl.value.trim()) || '1396',
			season: (seasonEl && seasonEl.value.trim()) || '1',
			episode: (episodeEl && episodeEl.value.trim()) || '1'
		};
	}
	const movieEl = document.getElementById('providerCheckTmdbId');
	return { type: 'movie', id: (movieEl && movieEl.value.trim()) || '278' };
}
async function saveProviderCheckSeries(){
	const target = readProviderCheckTarget();
	if(!/^\d+$/.test(target.id)){ setStatus('TMDB ID must be numeric', true); return; }
	if(!/^\d+$/.test(target.season) || Number(target.season) < 1){ setStatus('Season must be a positive number', true); return; }
	if(!/^\d+$/.test(target.episode) || Number(target.episode) < 1){ setStatus('Episode must be a positive number', true); return; }
	try {
		const r = await fetch(U('/api/config'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
			providerCheckType: 'series',
			providerCheckSeriesTmdbId: target.id,
			providerCheckSeason: Number(target.season),
			providerCheckEpisode: Number(target.episode)
		})});
		const js = await r.json();
		if(!js.success) throw new Error(js.error||'Save failed');
		setStatus(`TV provider check saved: ${target.id} S${target.season}E${target.episode}`);
	} catch(e){ setStatus(e.message, true); }
}
async function runProviderFunctionalChecks(){
	if(providerChecksRunning) return;
	const checkTarget = readProviderCheckTarget();
	const targetTmdb = checkTarget.id;
	const animeCheckTmdbEl = document.getElementById('animeProviderCheckTmdbId');
	const animeTargetTmdb = (animeCheckTmdbEl && animeCheckTmdbEl.value.trim()) || '1363974';
	const provEnhanced = document.getElementById('statusProvidersEnhanced');
	const summary = document.getElementById('providerCheckSummary');
	if(!provEnhanced || !summary) return;
	const runBtn = document.getElementById('runProviderChecksBtn');
	providerChecksRunning = true;
	if(runBtn) runBtn.disabled = true;
	summary.textContent = 'Running checks...';
	const rows = Array.from(provEnhanced.querySelectorAll('.prov-row:not(.header)'));
	let completed=0, passed=0;
	async function checkProvider(row){
		const name = row.dataset.provider;
		const funcBadge = row.querySelector('[data-role="functional"]');
		const notesEl = row.querySelector('[data-role="notes"]');
		if(funcBadge){ funcBadge.textContent='…'; funcBadge.className='badge'; }
		if(notesEl) notesEl.textContent='';
		// Skip disabled providers
		if(row.querySelector('.badge.ok, .badge.off') && row.children[1].textContent==='off'){
			if(funcBadge){ funcBadge.textContent='skip'; funcBadge.className='badge off'; }
			completed++;
			summary.textContent = `Progress: ${completed}/${rows.length} (passed: ${passed})`;
			return;
		}
		try {
			const token = currentStreamTokenHash();
			const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
			const isAnime = row.dataset.category === 'Anime';
			const checkType = isAnime ? 'anime' : checkTarget.type;
			const checkId = isAnime ? animeTargetTmdb : checkTarget.id;
			const seriesQuery = (!isAnime && checkTarget.type === 'series')
				? `&season=${encodeURIComponent(checkTarget.season)}&episode=${encodeURIComponent(checkTarget.episode)}`
				: '';
			const r = await fetch(U(`/api/streams/${name}/${checkType}/${checkId}${tokenQuery}${seriesQuery}`));
			const j = await readStreamCheckResponse(r);
			const isOk = j && Array.isArray(j.streams) && j.streams.length>0;
			if(isOk){
				passed++;
				if(funcBadge){ funcBadge.textContent='ok'; funcBadge.className='badge ok'; }
				if(notesEl) notesEl.textContent = `${j.streams.length} streams`;
			}else{
				if(funcBadge){ funcBadge.textContent='none'; funcBadge.className='badge fail'; }
				if(notesEl) notesEl.textContent = 'No streams array';
			}
		}catch(err){
			console.error(`[provider-check] ${name}: ${err.message}`);
			if(funcBadge){ funcBadge.textContent='fail'; funcBadge.className='badge fail'; }
			if(notesEl) notesEl.textContent = err.message;
		}
		completed++;
		summary.textContent = `Progress: ${completed}/${rows.length} (passed: ${passed})`;
	}
	let nextRow = 0;
	async function worker(){
		while(nextRow < rows.length){
			const row = rows[nextRow++];
			await checkProvider(row);
		}
	}
	try {
		await Promise.all(Array.from({ length: Math.min(4, rows.length) }, () => worker()));
		summary.textContent = `Checks complete: ${passed}/${rows.length} passed`;
	} finally {
		providerChecksRunning = false;
		if(runBtn) runBtn.disabled = false;
	}
}
async function saveProviderCheckTmdbId(){
	const input = document.getElementById('providerCheckTmdbId');
	const val = (input ? input.value : '').trim();
	if(!val){ setStatus('Enter a TMDB ID to save', true); return; }
	if(!/^\d+$/.test(val)){ setStatus('TMDB ID must be numeric', true); return; }
	try {
		const r = await fetch(U('/api/config'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ providerCheckTmdbId: val })});
		const js = await r.json();
		if(!js.success) throw new Error(js.error||'Save failed');
		setStatus('Provider check TMDB ID saved: '+val);
	} catch(e){ setStatus(e.message, true); }
}
async function saveAnimeProviderCheckTmdbId(){
	const input = document.getElementById('animeProviderCheckTmdbId');
	const button = document.getElementById('saveAnimeProviderCheckTmdbBtn');
	const val = (input ? input.value : '').trim();
	if(!/^[1-9]\d*$/.test(val)){ setStatus('Enter a positive numeric anime TMDB movie ID', true); return; }
	button.disabled = true;
	try {
		const r = await fetch(U('/api/config'), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ animeProviderCheckTmdbId: val }) });
		const result = await r.json();
		if(!r.ok || !result.success) throw new Error(result.error || 'Save failed');
		setStatus('Anime provider check TMDB movie ID saved: '+val);
	} catch(e){ setStatus(e.message, true); }
	finally { button.disabled = false; }
}
document.addEventListener('DOMContentLoaded', ()=> {
	initTheme();
	attachCoreListeners();
	document.getElementById('saveMovieboxSettingsBtn')?.addEventListener('click', saveMovieboxSettings);
	document.getElementById('saveMovieboxProxySettingsBtn')?.addEventListener('click', saveMovieboxProxySettings);
	document.getElementById('saveVidfastProxySettingsBtn')?.addEventListener('click', saveVidfastProxySettings);
	document.getElementById('saveVidyProxySettingsBtn')?.addEventListener('click', saveVidyProxySettings);
	document.getElementById('saveBingebangProxySettingsBtn')?.addEventListener('click', saveBingebangProxySettings);
	document.getElementById('saveVideasyProxySettingsBtn')?.addEventListener('click', saveVideasyProxySettings);
	document.getElementById('saveVidloveProxySettingsBtn')?.addEventListener('click', saveVidloveProxySettings);
	document.getElementById('saveSuperstreamProxySettingsBtn')?.addEventListener('click', saveSuperstreamProxySettings);
	document.getElementById('saveBowlerProxySettingsBtn')?.addEventListener('click', saveBowlerProxySettings);
	document.getElementById('saveCinesrcProxySettingsBtn')?.addEventListener('click', saveCinesrcProxySettings);
	document.getElementById('saveBarbarianProxySettingsBtn')?.addEventListener('click', saveBarbarianProxySettings);
	document.getElementById('saveFrameXTVProxySettingsBtn')?.addEventListener('click', saveFrameXTVProxySettings);
	document.getElementById('saveMinerProxySettingsBtn')?.addEventListener('click', saveMinerProxySettings);
	document.getElementById('saveTitanProxySettingsBtn')?.addEventListener('click', saveTitanProxySettings);
		document.getElementById('saveValkyrieProxySettingsBtn')?.addEventListener('click', saveValkyrieProxySettings);
		document.getElementById('saveVidrockProxySettingsBtn')?.addEventListener('click', saveVidrockProxySettings);
	document.getElementById('downloadMovieboxProxyListBtn')?.addEventListener('click', downloadMovieboxProxyList);
	document.getElementById('downloadVidfastProxyListBtn')?.addEventListener('click', downloadVidfastProxyList);
	document.getElementById('downloadVidyProxyListBtn')?.addEventListener('click', downloadVidyProxyList);
	document.getElementById('downloadBingebangProxyListBtn')?.addEventListener('click', downloadBingebangProxyList);
	document.getElementById('downloadVideasyProxyListBtn')?.addEventListener('click', downloadVideasyProxyList);
	document.getElementById('downloadVidloveProxyListBtn')?.addEventListener('click', downloadVidloveProxyList);
	document.getElementById('downloadSuperstreamProxyListBtn')?.addEventListener('click', downloadSuperstreamProxyList);
	document.getElementById('downloadBowlerProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('Bowler'));
	document.getElementById('downloadCinesrcProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('Cinesrc'));
	document.getElementById('downloadBarbarianProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('Barbarian'));
	document.getElementById('downloadFrameXTVProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('FrameXTV'));
	document.getElementById('downloadMinerProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('Miner'));
	document.getElementById('downloadTitanProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('Titan'));
		document.getElementById('downloadValkyrieProxyListBtn')?.addEventListener('click', () => downloadProviderProxyList('Valkyrie'));
		document.getElementById('downloadVidrockProxyListBtn')?.addEventListener('click', downloadVidrockProxyList);
	for(const provider of ['bowler', 'cinesrc', 'barbarian', 'framextv', 'miner', 'titan', 'valkyrie', 'vidrock']){
		document.getElementById(`${provider}ProxyEnabled`)?.addEventListener('change', event=>{
			const label = document.getElementById(`${provider}ProxyEnabledLabel`);
			label?.classList.toggle('on', event.target.checked);
			const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
			if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
		});
	}
	document.getElementById('movieboxProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('movieboxProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	document.getElementById('videasyProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('videasyProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	document.getElementById('vidloveProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('vidloveProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	document.getElementById('superstreamProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('superstreamProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	document.getElementById('vidfastProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('vidfastProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	document.getElementById('vidyProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('vidyProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	document.getElementById('bingebangProxyEnabled')?.addEventListener('change', event=>{
		const label = document.getElementById('bingebangProxyEnabledLabel');
		label?.classList.toggle('on', event.target.checked);
		const labelText = label?.querySelector('.moviebox-proxy-toggle__label');
		if(labelText) labelText.textContent = event.target.checked ? 'Proxy enabled' : 'Enable proxy';
	});
	bindNavigation();
	bindShellControls();
	const logoutBtn = document.getElementById('logoutBtn');
	if(logoutBtn){
		logoutBtn.addEventListener('click', async ()=>{
			try { await fetch(U('/auth/logout'),{method:'POST'}); } catch {}
			// Use replace to avoid creating extra history entry
			location.replace(U('/?loggedOut=1'));
		});
	}
	const restartBtn = document.getElementById('restartBtn');
	if(restartBtn){
		restartBtn.addEventListener('click', async ()=>{
			const ok = await openConfirmRestart();
			if(!ok) return;
			setStatus('Restarting server…');
			try {
				const r = await fetch(U('/api/restart'),{ method:'POST' });
				if(!r.ok){ const t = await r.text().catch(()=>r.statusText); throw new Error(t||('HTTP '+r.status)); }
				const restart = await r.json();
				// Server will shut down soon; start polling until it comes back
				await new Promise(resolve => setTimeout(resolve, 1000));
				const start = Date.now();
				const timeoutMs = 60_000;
				(async function poll(){
					try {
						const pr = await fetch(U('/api/health'),{ cache:'no-store', signal: AbortSignal.timeout(5000) });
						if(pr.ok){
							const health = await pr.json();
							if (health.instanceId && health.instanceId !== restart.instanceId && !health.restartPending) { location.reload(); return; }
						}
					} catch {}
					if(Date.now()-start > timeoutMs){ setStatus('Restart timed out', true); return; }
					setTimeout(poll, 1000);
				})();
			} catch(e){ setStatus('Restart failed: '+e.message, true); }
		});
	}
	reload();
	const h = location.hash.slice(1);
	navTo(h||'panel-core');
	// Revalidate session on back-forward cache navigation or visibility
	window.addEventListener('pageshow', (e)=>{
		if(e.persisted){ verifySession(); }
	});
	document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') verifySession(); });
	// Advanced flag checkbox change -> validation
	document.getElementById('advFlags')?.addEventListener('change', (e)=>{
		if(e.target.matches('.adv-flag-item input[type="checkbox"]')) {
			validate();
		}
	});
		const rsb = document.getElementById('refreshStatusBtn');
		if(rsb) rsb.addEventListener('click', loadServerStatus);
		const rlb = document.getElementById('refreshConsoleLogsBtn');
		if(rlb) rlb.addEventListener('click', refreshConsoleLogs);
		const slb = document.getElementById('saveConsoleLogsBtn');
		if(slb) slb.addEventListener('click', saveConsoleLogsAsFile);
		const rpc = document.getElementById('runProviderChecksBtn');
	if(rpc) rpc.addEventListener('click', runProviderFunctionalChecks);
	const spc = document.getElementById('saveProviderCheckTmdbBtn');
	if(spc) spc.addEventListener('click', saveProviderCheckTmdbId);
	const animeSave = document.getElementById('saveAnimeProviderCheckTmdbBtn');
	if(animeSave) animeSave.addEventListener('click', saveAnimeProviderCheckTmdbId);
});
function toggleSidebar(force){
	const sb = document.getElementById('sidebar');
	const showing = force !== undefined ? force : !sb.classList.contains('open');
	sb.classList.toggle('open', showing);
	document.querySelector('.overlay').classList.toggle('show', showing);
}
function validate(){
	const f = document.getElementById('cfgForm');
	const errors = [];
	const qp = document.querySelector('input[name="qualityPreset"]:checked');
	if(qp && qp.value==='custom') {
		const mq = f.elements['minQualitiesRaw'].value.trim();
		if(mq && /[\{\[]/.test(mq)) { try { JSON.parse(mq); } catch(e){ errors.push('Min Qualities invalid JSON'); markInvalid(f.elements['minQualitiesRaw']); } }
	}
	const codecPreset = document.querySelector('input[name="codecPreset"]:checked');
	if(codecPreset && codecPreset.value==='advanced') {
		const ec = f.elements['excludeCodecsRaw'].value.trim();
		if(ec && /[\{\[]/.test(ec)) { try { JSON.parse(ec); } catch(e){ errors.push('Exclude Codecs invalid JSON'); markInvalid(f.elements['excludeCodecsRaw']); } }
	}
	const p = f.elements['port'].value.trim();
	if(p) { const pn = Number(p); if(!(pn>0 && pn<=65535)) { errors.push('Port must be 1-65535'); markInvalid(f.elements['port']); } }
	const dp = f.elements['defaultProviders'].value.trim();
	if(dp && !/^[a-z0-9_,\-\s]+$/.test(dp)) { errors.push('Default Providers contains invalid chars'); markInvalid(f.elements['defaultProviders']); }
	const sum = document.getElementById('validationSummary');
	if(errors.length){ sum.textContent = errors.join(' • '); sum.classList.add('has-errors'); }
	else { sum.textContent=''; sum.classList.remove('has-errors'); }
	document.getElementById('saveBtn').disabled = errors.length>0;
	return errors.length===0;
}
function markInvalid(el){ el.classList.add('invalid'); setTimeout(()=>el.classList.remove('invalid'), 3000); }
document.addEventListener('input', (e)=>{
	if(e.target.closest('#cfgForm')) validate();
});
document.addEventListener('change', (e)=>{
	const t = e.target;
	if(t.name === 'qualityPreset') {
		const customField = document.querySelector('textarea[name="minQualitiesRaw"]');
		if(t.value === 'custom') { customField.disabled = false; } else { customField.disabled = true; customField.value=''; }
		validate();
	}
	if(t.name === 'codecPreset') {
		const ta = document.querySelector('textarea[name="excludeCodecsRaw"]');
		if(t.value==='advanced') { ta.disabled=false; if(!ta.value.trim()) ta.value = JSON.stringify({excludeDV:false,excludeHDR:false}); }
		else { ta.disabled=true; ta.value=''; }
		validate();
	}
});
async function renderProviderMatrix(merged){
	if(!merged){ try { const data = await fetchConfig(); merged = data.merged||{}; } catch { return; } }
	const container = document.getElementById('providerMatrix'); if(!container) return;
	const defaults = (merged.defaultProviders||[]).map(s=>s.toLowerCase());
	
	// Fetch available providers from API
	let availableProviders = [];
	try {
		const providersResponse = await fetch(U('/api/providers'));
		if (providersResponse.ok) {
			const providersData = await providersResponse.json();
			availableProviders = providersData.providers || [];
		}
		} catch (e) {
			console.warn('Failed to fetch providers list:', e.message);
		}

		// Create provider list with enable flags
		const providers = availableProviders.map(p => {
			const flag = `enable${p.name.charAt(0).toUpperCase() + p.name.slice(1)}Provider`;
			return [p.name, flag, p.category || 'MoviesTv'];
		});

		container.innerHTML = providers.map(([name,flag,category])=>{
			const enabled = merged[flag] !== false;
			const isDefault = defaults.includes(name);
			return `<div class="col"><div class=\"pm-item\" data-prov=\"${name}\" data-category=\"${category}\" data-flag=\"${flag}\" data-enabled=\"${enabled}\" data-default=\"${isDefault}\">`
				+`<button type=\"button\" class=\"pm-enable btn ${enabled ? 'btn-outline-success' : 'btn-outline-danger'}\" title=\"${enabled ? 'Disable' : 'Enable'} ${name}\" aria-label=\"${enabled ? 'Disable' : 'Enable'} ${name}\" aria-pressed=\"${enabled}\" data-action=\"toggle-enable\"><i class=\"bi ${enabled ? 'bi-check' : 'bi-x'}\" aria-hidden=\"true\"></i></button>`
				+`<span class=\"pm-name\">${name}</span>`
				+`<button type=\"button\" class=\"pm-default\" title=\"Toggle Default\" data-action=\"toggle-default\">${isDefault? '★':'☆'}</button>`
				+`<button type=\"button\" class=\"pm-test btn btn-outline-primary\" title=\"Test ${name}\" aria-label=\"Test ${name}\" data-action=\"test-provider\"><i class=\"bi bi-play-circle\" aria-hidden=\"true\"></i></button>`
				+`</div></div>`;
	}).join('');
	const hidden = document.querySelector('input[name="defaultProviders"]'); if(hidden) hidden.value = defaults.join(',');
	if(!container._bound){
		container.addEventListener('click', async (e)=>{
			const btn = e.target.closest('button[data-action]'); if(!btn) return;
				const item = btn.closest('.pm-item'); if(!item) return;
				const prov = item.dataset.prov; const flag = item.dataset.flag;
				if(btn.dataset.action==='test-provider'){
					openProviderTestDialog(prov, item.dataset.category);
					return;
				}
				let data; try { data = await fetchConfig(); } catch(err){ setStatus('Provider fetch failed',true); return; }
			const mergedNow = data.merged||{};
			let defaultsNow = (mergedNow.defaultProviders||[]).slice();
			const patch = {};
			if(btn.dataset.action==='toggle-enable'){
				const currentlyEnabled = item.dataset.enabled==='true';
				patch[flag] = !currentlyEnabled;
				if(currentlyEnabled){ defaultsNow = defaultsNow.filter(d=>d!==prov); patch.defaultProviders = defaultsNow; }
			} else if(btn.dataset.action==='toggle-default'){
				const isDefault = item.dataset.default==='true';
				if(isDefault){ defaultsNow = defaultsNow.filter(d=>d!==prov); }
				else { if(!defaultsNow.includes(prov)) defaultsNow.push(prov); patch[flag] = true; }
				patch.defaultProviders = defaultsNow;
			}
			try {
				await fetch(U('/api/config'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
				const updated = await fetchConfig();
				fillForm(updated);
				renderProviderMatrix(updated.merged);
				reloadLiveOnly();
			} catch(err){ setStatus('Update failed: '+err.message,true); }
		});
		container._bound = true;
	}
}
function reloadLiveOnly(){
	fetchConfig().then(c=>{
		document.getElementById('currentCfg').textContent = JSON.stringify(c.merged||{},null,2);
		document.getElementById('overrideCfg').textContent = (c.override && Object.keys(c.override).length)? JSON.stringify(c.override,null,2):'(none)';
	}).catch(()=>{});
}

// No globals exported; all handlers bound programmatically
})();
