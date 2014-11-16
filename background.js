(function(){
function older(o,n){
	o=(o||'').split('.');n=(n||'').split('.');
	var r=/(\d*)([a-z]*)(\d*)([a-z]*)/i;
	while(o.length&&n.length) {
		var vo=o.shift().match(r),vn=n.shift().match(r);
		vo.shift();vn.shift();	// origin string
		vo[0]=parseInt(vo[0]||0,10);
		vo[2]=parseInt(vo[2]||0,10);
		vn[0]=parseInt(vn[0]||0,10);
		vn[2]=parseInt(vn[2]||0,10);
		while(vo.length&&vn.length) {
			var eo=vo.shift(),en=vn.shift();
			if(eo!=en) return eo<en;
		}
	}
	return n.length>0;
}

// Check Maxthon version
(function(l,v){
	if(older(l,v)) {	// first use or new update
		localStorage.lastVersion=v;
		if(older(v,'4.1.1.1600'))	// early versions may have bugs
			br.tabs.newTab({url:'https://github.com/gera2ld/Violentmonkey-mx/wiki/ObsoleteMaxthon',activate:true});
	}
})(localStorage.lastVersion||'',window.external.mxVersion);

/* ===============Data format 0.5==================
 * Database: Violentmonkey
 * scripts {
 * 		id: Auto
 * 		uri: String
 * 		custom: List-Dict	// Custom meta data
 * 		meta: List-Dict
 * 		enabled: 0|1
 * 		update: 0|1
 * 		position: Integer
 * 		code: String
 * }
 * require {
 * 		uri: String
 * 		data: TEXT
 * }
 * cache {
 * 		uri: String
 * 		data: Base64 encoded TEXT
 * }
 * values {
 * 		uri: String
 * 		values: TEXT
 * }
 */
function notify(title,options) {
	function show() {
		var n=new Notification(title+' - '+_('extName'),{
			body:options.body,
		});
		n.onclick=options.onclick;
	}
	if(Notification.permission=='granted') show();
	else Notification.requestPermission(function(e){
		if(e=='granted') show(); else console.log('Notification: '+options.body);
	});
}
function dbError(t,e){
	notify(_('Error'),{body:'Database error >>> '+e.message});
}
function initDatabase(callback){
	db=openDatabase('Violentmonkey','0.5','Violentmonkey data',10*1024*1024);
	db.transaction(function(t){
		function executeSql(_t,r){
			var s=sql.shift();
			if(s) t.executeSql(s,[],executeSql,dbError);
			else if(callback) callback();
		}
		var count=0,sql=[
			'CREATE TABLE IF NOT EXISTS scripts(id INTEGER PRIMARY KEY,uri VARCHAR,meta TEXT,custom TEXT,enabled INTEGER,"update" INTEGER,position INTEGER,code TEXT)',
			'CREATE TABLE IF NOT EXISTS cache(uri VARCHAR UNIQUE,data TEXT)',
			'CREATE TABLE IF NOT EXISTS require(uri VARCHAR UNIQUE,data TEXT)',
			'CREATE TABLE IF NOT EXISTS "values"(uri VARCHAR UNIQUE,data TEXT)',
		];
		executeSql();
	});
}
function upgradeData(callback){
	function finish(){if(callback) callback();}
	var dataVer='0.5.1';
	if(older(localStorage.version_storage||'',dataVer)){
		db.transaction(function(t){
			function update(){
				var o=data.shift();
				if(!o) finish();
				else t.executeSql('UPDATE scripts SET meta=? WHERE id=?',[JSON.stringify(o[1]),o[0]],update,dbError);
			}
			var data=[],i,v;
			t.executeSql('SELECT * FROM scripts',[],function(t,r){
				for(i=0;i<r.rows.length;i++) {
					v=r.rows.item(i);
					data.push([v.id,parseMeta(v.code)]);
				}
				update();
			},dbError);
		});
		localStorage.version_storage=dataVer;
	} else finish();
}

function isRemote(url){
	return url&&!/^data:/.test(url);
}
function getNameURI(i){
	var ns=i.meta.namespace||'',n=i.meta.name||'',k=escape(ns)+':'+escape(n)+':';
	if(!ns&&!n) k+=i.id;return k;
}
function newScript(){
	var r={
		custom:{},
		enabled:1,
		update:1,
		code:'// ==UserScript==\n// @name New Script\n// ==/UserScript==\n'
	};
	r.meta=parseMeta(r.code);
	return r;
}
function saveScript(o,src,callback){
	if(!o.position) o.position=++pos;
	db.transaction(function(t){
		var d=[];
		d.push(parseInt(o.id)||null);
		d.push(o.uri);
		d.push(JSON.stringify(o.meta));
		d.push(JSON.stringify(o.custom));
		d.push(o.enabled=o.enabled?1:0);
		d.push(o.update=o.update?1:0);
		d.push(o.position);
		d.push(o.code);
		t.executeSql('REPLACE INTO scripts(id,uri,meta,custom,enabled,"update",position,code) VALUES(?,?,?,?,?,?,?,?)',d,function(t,r){
			if(!o.id) o.id=r.insertId;
			if(ids) {		// avoid update in data upgradation
				if(!(o.id in metas)) ids.push(o.id);
				metas[o.id]=getScript(o,true);
			}
			if(callback) callback(o);
		},dbError);
	});
}
function removeScript(id,src,callback){
	var i=ids.indexOf(id);if(i>=0) ids.splice(i,1);
	db.transaction(function(t){
		t.executeSql('DELETE FROM scripts WHERE id=?',[id],function(t,r){
			delete metas[id];
			if(callback) callback();
		},dbError);
	});
}
function str2RE(s){return s.replace(/(\.|\?|\/)/g,'\\$1').replace(/\*/g,'.*?');}
function autoReg(s,w){	// w: forced wildcard mode
	if(!w&&s[0]=='/'&&s.slice(-1)=='/') return RegExp(s.slice(1,-1));	// Regular-expression
	return RegExp('^'+str2RE(s)+'$');	// String with wildcards
}
var match_reg=/(.*?):\/\/([^\/]*)\/(.*)/;
function matchTest(s,u){
	var m=s.match(match_reg);
	if(!m) return false;
	// scheme
	if(!(
		m[1]=='*'&&/^https?$/i.test(u[1])	// * = http|https
		||m[1]==u[1]
	)) return false;
	// host
	if(m[2]!='*') {
		if(m[2].slice(0,2)=='*.') {
			if(u[2]!=m[2].slice(2)&&u[2].slice(1-m[2].length)!=m[2].slice(1)) return false;
		} else if(m[2]!=u[2]) return false;
	}
	// pathname
	if(!autoReg(m[3],1).test(u[3])) return false;
	return true;
}
function testURL(url,e){
	var f=true,i,inc=[],exc=[],mat=[],u=url.match(match_reg);
	if(e.custom._match!=false&&e.meta.match) mat=mat.concat(e.meta.match);
	if(e.custom.match) mat=mat.concat(e.custom.match);
	if(e.custom._include!=false&&e.meta.include) inc=inc.concat(e.meta.include);
	if(e.custom.include) inc=inc.concat(e.custom.include);
	if(e.custom._exclude!=false&&e.meta.exclude) exc=exc.concat(e.meta.exclude);
	if(e.custom.exclude) exc=exc.concat(e.custom.exclude);
	if(mat.length) {for(i=0;i<mat.length;i++) if(f=u&&matchTest(mat[i],u)) break;}	// @match
	else for(i=0;i<inc.length;i++) if(f=autoReg(inc[i]).test(url)) break;	// @include
	if(f) for(i=0;i<exc.length;i++) if(!(f=!autoReg(exc[i]).test(url))) break;	// @exclude
	return f;
}
function getScript(v,metaonly){
	var o={
		id:v.id,
		uri:v.uri,
		meta:typeof v.meta=='object'?v.meta:JSON.parse(v.meta),
		custom:typeof v.custom=='object'?v.custom:JSON.parse(v.custom),
		enabled:v.enabled?1:0,
		update:v.update?1:0,
		position:v.position
	};
	if(!metaonly) o.code=v.code;
	return o;
}
function getScripts(ids,metaonly,callback){
	var data=[];
	db.readTransaction(function(t){
		function getItem(){
			var i=ids.shift();
			if(i) t.executeSql('SELECT * FROM scripts WHERE id=?',[i],function(t,r){
				if(r.rows.length) data.push(getScript(r.rows.item(0),metaonly));
				getItem();
			},dbError); else if(callback) callback(data);
		}
		getItem();
	});
}
function initScripts(callback){
	ids=[];metas={};
	db.readTransaction(function(t){
		t.executeSql('SELECT * FROM scripts ORDER BY position',[],function(t,r){
			var i,v,o=null;
			for(i=0;i<r.rows.length;i++) {
				v=r.rows.item(i);
				o=getScript(v,true);
				ids.push(o.id);metas[o.id]=o;
			}
			pos=o?o.position:0;
			if(callback) callback();
		});
	});
}
function getData(d,src,callback) {
	var data={scripts:[],settings:settings},cache={};
	ids.forEach(function(i){
		var o=metas[i];
		data.scripts.push(o);
		if(isRemote(o.meta.icon)) cache[o.meta.icon]=1;
	});
	getCache({table:'cache',uris:Object.getOwnPropertyNames(cache),objectURL:true},function(o){
		data.cache=o;if(callback) callback(data);
	});
}
function updateMeta(o,src,callback){
	var s=metas[o.id],d,v=[];if(!s) return;
	delete o.id;d=Object.getOwnPropertyNames(o);
	if(!d.length) return;
	d.forEach(function(i){v.push(s[i]=o[i]);});
	v.push(s.id);d=d.join('=?,')+'=?';
	db.transaction(function(t){
		t.executeSql('UPDATE scripts SET '+d+' WHERE id=?',v,function(t,r){
			if(r.rowsAffected) {
				updateItem({id:s.id,obj:s,status:0});
				if(callback) callback();
			}
		},dbError);
	});
}
function getValues(uris,callback,t){
	var data={};
	function query(t){
		function loop(){
			var i=uris.pop();
			if(i) t.executeSql('SELECT data FROM "values" WHERE uri=?',[i],function(t,r){
				if(r.rows.length) data[i]=JSON.parse(r.rows.item(0).data);
				loop();
			}); else if(callback) callback(data);
		}
		loop();
	}
	if(t) query(t); else db.readTransaction(query);
}
function getCache(args,callback,t){
	var data={};
	function query(t){
		function loop(){
			var i=args.uris.pop();
			if(i) t.executeSql('SELECT data FROM '+args.table+' WHERE uri=?',[i],function(t,r){
				if(r.rows.length) data[i]=r.rows.item(0).data;
				loop();
			}); else if(callback) callback(data);
		}
		loop();
	}
	if(t) query(t); else db.readTransaction(query);
}
function getInjected(o,src,callback){
	var data={isApplied:settings.isApplied},cache={},require={},values={};
	function finish(){callback(data);}
	if(settings.isApplied&&src.url.slice(0,5)!='data:') {
		getScripts(
			ids.filter(function(i){
				var j,s=metas[i];
				if(s&&testURL(src.url,s)) {
					if(s.enabled) {
						values[s.uri]=1;
						if(s.meta.require) s.meta.require.forEach(function(i){require[i]=1;});
						for(j in s.meta.resources) cache[s.meta.resources[j]]=1;
					}
					return true;
				}
				return false;
			}),false,function(o){
				data.scripts=o;
				getCache({table:'require',uris:Object.getOwnPropertyNames(require)},function(o){
					data.require=o;
					getCache({table:'cache',uris:Object.getOwnPropertyNames(cache)},function(o){
						data.cache=o;
						getValues(Object.getOwnPropertyNames(values),function(o){
							data.values=o;
							finish();
						});
					});
				});
			}
		);
	} else finish();
}
function setValue(data,src,callback){
	db.transaction(function(t){
		t.executeSql('REPLACE INTO "values"(uri,data) VALUES(?,?)',[data.uri,JSON.stringify(data.values)],function(t,r){
			if(callback) callback();
		},dbError);
	});
}
function parseMeta(d){
	var o=-1,meta={include:[],exclude:[],match:[],require:[],resource:[],grant:[]};
	d.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g,function(m,k,v){
		if(o<0&&k=='==UserScript==') o=1;
		else if(k=='==/UserScript==') o=0;
		if(o==1&&k[0]=='@') k=k.slice(1); else return;
		v=v.replace(/^\s+|\s+$/g,'');
		if(meta[k]&&meta[k].push) meta[k].push(v);	// multiple values allowed
		else if(!(k in meta)) meta[k]=v;	// only first value will be stored
	});
	meta.resources={};
	meta.resource.forEach(function(i){
		o=i.match(/^(\w\S*)\s+(.*)/);
		if(o) meta.resources[o[1]]=o[2];
	});
	delete meta.resource;
	if(!meta.homepageURL&&meta.homepage) meta.homepageURL=meta.homepage;	// @homepageURL instead of @homepage
	return meta;
}
function fetchURL(url,cb,type,headers){
	var req=new XMLHttpRequest(),i;
	req.open('GET',url,true);
	if(type) req.responseType=type;
	if(headers) for(i in headers)
		req.setRequestHeader(i,headers[i]);
	req.onloadend=function(){if(cb) cb.call(req);};
	req.send();
}
function saveData(url,table,data){
	db.transaction(function(t){
		t.executeSql('REPLACE INTO "'+table+'"(uri,data) VALUES(?,?)',[url,data],null,dbError);
	});
}
var _cache={},_require={};
function fetchCache(url,callback){
	if(_cache[url]) return;
	_cache[url]=1;
	fetchURL(url,function(){
		if(this.status!=200) return;
		var r=new FileReader();
		r.onload=function(e){
			e=window.btoa(r.result);
			if(callback) callback(e); else saveData(url,'cache',e);
		};
		r.readAsBinaryString(this.response);
	},'blob');
}
function fetchRequire(url){
	if(_require[url]) return;
	_require[url]=1;
	fetchURL(url,function(){
		if(this.status==200) saveData(url,'require',this.responseText);
	});
}

function queryScript(id,meta,callback){
	db.readTransaction(function(t){
		function queryMeta() {
			var uri=getNameURI({id:'',meta:meta});
			if(uri=='::') callback(newScript());
			else t.executeSql('SELECT * FROM scripts WHERE uri=?',[uri],function(t,r){
				if(callback) {
					if(r.rows.length) callback(getScript(r.rows.item(0)));
					else callback(newScript());
				}
			});
		}
		function queryId() {
			t.executeSql('SELECT * FROM scripts WHERE id=?',[id],function(t,r){
				if(r.rows.length) {
					if(callback) callback(getScript(r.rows.item(0)));
				} else queryMeta();
			});
		}
		queryId();
	});
}
function parseScript(d,src,callback){
	function finish(){
		updateItem(r);if(callback) callback(r);
	}
	var i,r={status:0,message:'message' in d?d.message:_('msgUpdated')};
	if(d.status&&d.status!=200||!d.code) {
		r.status=-1;r.message=_('msgErrorFetchingScript');
		finish();
	} else {
		var meta=parseMeta(d.code);
		queryScript(d.id,meta,function(c){
			if(!c.id){r.status=1;r.message=_('msgInstalled');}
			if(d.more) for(i in d.more) if(i in c) c[i]=d.more[i];	// for import and user edit
			c.meta=meta;c.code=d.code;c.uri=getNameURI(c);
			if(src&&src.url&&!c.meta.homepageURL&&!c.custom.homepageURL&&!/^(file|data):/.test(src.url)) c.custom.homepageURL=src.url;
			if(d.url&&!/^(file|data):/.test(d.url)) c.custom.lastInstallURL=d.url;
			saveScript(c,null,function(){
				r.obj=metas[r.id=c.id];finish();
				if(!meta.grant.length)
					notify(_('Warning'),{
						body:_('msgWarnGrant',[meta.name||_('labelNoName')]),
						onclick:function(){
							br.tabs.newTab({
								activate:true,
								url:'http://wiki.greasespot.net/@grant',
							});
							this.close();
						},
					});
			});
		});
		meta.require.forEach(function(u){
			var r=d.require&&d.require[u];
			if(r) saveData(u,'require',r); else fetchRequire(u);
		});	// @require
		for(i in meta.resources) {	// @resource
			var u=meta.resources[i],c=d.resources&&d.resources[u];
			if(c) saveData(u,'cache',c); else fetchCache(u);
		}
		if(isRemote(meta.icon)) fetchCache(meta.icon);	// @icon
	}
}
function move(o,src,callback){
	function update(o){
		db.transaction(function(t){
			function loop(){
				var i=o.shift();
				if(i) t.executeSql('UPDATE scripts SET position=? WHERE id=?',i,loop,dbError);
			}
			loop();
		});
	}
	// update ids
	var g=o.to>o.from?1:-1,x=ids[o.from],i,u=[],o1,o2;
	for(i=o.from;i!=o.to;i+=g) ids[i]=ids[i+g];ids[o.to]=x;
	x=metas[x].position;o1=metas[ids[o.to]];
	for(i=o.to;i!=o.from;i-=g) {
		o2=metas[ids[i-g]];
		o1.position=o2.position;
		u.push([o1.position,o1.id]);
		o1=o2;
	}
	o1.position=x;
	u.push([o1.position,o1.id]);
	update(u);
}
function vacuum(o,src,callback){
	var require={},cache={},values={},count=0;
	function vacuumPosition(){
		function update(o){
			db.transaction(function(t){
				function loop(){
					var i=o.shift();
					if(i) t.executeSql('UPDATE scripts SET position=? WHERE id=?',i,loop,dbError);
				}
				loop();
			});
		}
		var i,j,o,s=[];
		for(i=0;i<ids.length;i++) {
			o=metas[ids[i]];
			values[o.uri]=1;
			if(isRemote(o.meta.icon)) cache[o.meta.icon]=1;
			if(o.meta.require) o.meta.require.forEach(function(i){require[i]=1;});
			for(j in o.meta.resources) cache[o.meta.resources[j]]=1;
			if(o.position!=i+1) s.push([i+1,o.id]);
		}
		update(s);
		pos=i;
		vacuumDB('require',require);
		vacuumDB('cache',cache);
		vacuumDB('values',values);
	}
	function vacuumDB(n,d){
		function del(o){
			db.transaction(function(t){
				function loop(){
					var i=o.shift();
					if(i) t.executeSql('DELETE FROM "'+n+'" WHERE uri=?',i,loop,dbError);
				}
				loop();
			});
		}
		count++;
		db.readTransaction(function(t){
			t.executeSql('SELECT * FROM "'+n+'"',[],function(t,r){
				var o,s=[];
				for(i=0;i<r.rows.length;i++) {
					o=r.rows.item(i);
					if(!d[o.uri]) s.push([o.uri]);
					else d[o.uri]++;	// stored
				}
				del(s);
				if(!--count) finish();
			},dbError);
		});
	}
	function finish(){
		var i;
		for(i in require) if(require[i]==1) fetchRequire(i);
		for(i in cache) if(cache[i]==1) fetchCache(i);
		if(callback) callback();
	}
	vacuumPosition();
}

var _update={};
function checkUpdateO(o){
	if(_update[o.id]) return;_update[o.id]=1;
	function finish(){delete _update[o.id];}
	var r={id:o.id,updating:1,status:2};
	function update(){
		if(du) {
			r.message=_('msgUpdating');
			fetchURL(du,function(){
				parseScript({id:o.id,status:this.status,code:this.responseText});
			});
		} else r.message='<span class=new>'+_('msgNewVersion')+'</span>';
		updateItem(r);finish();
	}
	var du=o.custom.downloadURL||o.meta.downloadURL||o.custom.lastInstallURL,
			u=o.custom.updateURL||o.meta.updateURL||du;
	if(u) {
		r.message=_('msgCheckingForUpdate');updateItem(r);
		fetchURL(u,function(){
			r.message=_('msgErrorFetchingUpdateInfo');
			if(this.status==200) try{
				var m=parseMeta(this.responseText);
				if(older(o.meta.version,m.version)) return update();
				r.message=_('msgNoUpdate');
			}catch(e){}
			delete r.updating;
			updateItem(r);finish();
    },null,{Accept:'text/x-userscript-meta'});
	} else finish();
}
function checkUpdate(id,src,callback) {
	checkUpdateO(metas[id]);
	if(callback) callback();
}
function checkUpdateAll(e,src,callback) {
	setOption({key:'lastUpdate',value:Date.now()});
	ids.forEach(function(i){
		var o=metas[i];
		if(o.update) checkUpdateO(o);
	});
	if(callback) callback();
}

function exportZip(o,src,callback){
	var data={scripts:[],settings:settings},values=[];
	function finish(){callback(data);}
	getScripts(o.data,false,function(s){
		s.forEach(function(c){
			data.scripts.push(c);
			if(o.values) values.push(c.uri);
		});
		if(o.values) getValues(values,function(o){data.values=o;finish();});
		else finish();
	});
}
function updateItem(r){rt.post('UpdateItem',r);}
function getOption(k,src,callback){
	var v=localStorage.getItem(k)||'';
	try{
		v=JSON.parse(v);
	}catch(e){
		return false;
	}
	settings[k]=v;
	if(callback) callback(v);
	return true;
}
function setOption(o,src,callback){
	if(!o.check||(o.key in settings)) {
		localStorage.setItem(o.key,JSON.stringify(o.value));
		settings[o.key]=o.value;
	}
	if(callback) callback(o.value);
}
function initSettings(){
	function init(k,v){
		if(!getOption(k)) setOption({key:k,value:v});
	}
	init('isApplied',true);
	init('startReload',true);
	init('reloadHTTPS',false);
	init('autoUpdate',true);
	init('lastUpdate',0);
	init('showBadge',true);
	init('withData',true);
	init('closeAfterInstall',true);
	init('dataVer',0);
}
function autoCheck(o){	// check for updates automatically in 20 seconds
	function check(){
		if(settings.autoUpdate) {
			if(Date.now()-settings.lastUpdate>=864e5) checkUpdateAll();
			setTimeout(check,36e5);
		} else checking=false;
	}
	if(!checking) {checking=true;setTimeout(check,o||0);}
}
function autoUpdate(o,src,callback){
	setOption({key:'autoUpdate',value:o=!!o},src,autoCheck);
	if(callback) callback(o);
}

var badge=0,hideBadge;
function getBadge(o,src,callback){
	if(settings.showBadge) {
		badge++;	// avoid frequent asking for badge
		setTimeout(function(){
			if(!--badge) {
				hideBadge=true;
				injectContent('setBadge();');	// avoid error in compatible mode
				setTimeout(function(){
					if(hideBadge) rt.icon.hideBadge();
				},200);
			}
		},100);
	}
}
function setBadge(o,src,callback){
	hideBadge=false;
	if(settings.showBadge) rt.icon.showBadge(o);
}
function showBadge(o,src,callback){
	setOption({key:'showBadge',value:o=!!o},src,o&&getBadge);
	if(callback) callback(o);
}
function reinit(){
	var f=function(f){
		var c=0;
		if(!f) f=window.delayedReload=function(){
			c++;
			setTimeout(function(){
				if(!--c) location.reload();
			},1000);
		};
		f();
	};
	f='('+f.toString()+')(window.delayedReload)';
	f='(function(s){var o=document.createElement("script");o.innerHTML=s;document.body.appendChild(o);document.body.removeChild(o);})('+JSON.stringify(f)+')';
	if(!settings.reloadHTTPS) f='if(location.protocol!="https:")'+f;
	for(var i=0;i<br.tabs.length;i++) {
		var t=br.tabs.getTab(i);
		br.executeScript(f,t.id);
	}
}

var db,checking=false,settings={},ids=null,metas,pos;
initSettings();
initDatabase(function(){
	upgradeData(function(){
		initScripts(function(){
			rt.listen('Background',function(o){
				/*
				 * o={
				 * 	cmd: String,
				 * 	src: {
				 * 		id: String,
				 * 		url: String,
				 * 	},
				 * 	callback: String,
				 * 	data: Object
				 * }
				 */
				function callback(d){
					rt.post(o.src.id,{cmd:'Callback',data:{id:o.callback,data:d}});
				}
				var maps={
					NewScript:function(o,src,callback){callback(newScript());},
					RemoveScript: removeScript,
					GetData: getData,
					GetInjected: getInjected,
					CheckUpdate: checkUpdate,
					CheckUpdateAll: checkUpdateAll,
					SaveScript: saveScript,
					UpdateMeta: updateMeta,
					SetValue: setValue,
					GetOption: getOption,
					SetOption: setOption,
					ExportZip: exportZip,
					ParseScript: parseScript,
					GetScript: function(id,src,callback){	// for user edit
						db.readTransaction(function(t){
							t.executeSql('SELECT * FROM scripts WHERE id=?',[id],function(t,r){
								if(r.rows.length) callback(getScript(r.rows.item(0)));
							});
						});
					},
					GetMetas: function(ids,src,callback){	// for popup menu
						//getScripts(ids,true,callback);
						var d=[];
						ids.forEach(function(i){d.push(metas[i]);});
						callback(d);
					},
					AutoUpdate: autoUpdate,
					Vacuum: vacuum,
					Move: move,
					GetBadge: getBadge,
					SetBadge: setBadge,
					ShowBadge: showBadge,
					InstallScript:function(url,src,callback) {
						callback();
						br.tabs.newTab({
							activate:true,
							url:rt.getPrivateUrl()+'confirm.html?url='+encodeURIComponent(url)
						});
					},
					ParseMeta: function(o,src,callback){callback(parseMeta(o));},
				},f=maps[o.cmd];
				if(f) f(o.data,o.src,callback);
				return true;
			});
			if(settings.autoUpdate) autoCheck(2e4);
			rt.icon.setIconImage('icon'+(settings.isApplied?'':'w'));
			if(settings.startReload) reinit();
		});
	});
});

(function(url){
	var l=url.length;
	br.onBrowserEvent=function(o){
		var t,tab;
		switch(o.type){
			case 'TAB_SWITCH':
				tab=br.tabs.getCurrentTab();
				getBadge();
				if(tab.url.slice(0,l)==url)
					for(var i=0;i<br.tabs.length;i++) {
						t=br.tabs.getTab(i);
						if(t.id!=tab.id&&t.url.slice(0,l)==url) {
							tab.close();t.activate();
						}
					}
				break;
		}
	};
})(rt.getPrivateUrl()+'options.html');
})();
