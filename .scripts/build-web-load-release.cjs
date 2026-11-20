const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),stage=root;
process.env.NODE_ENV='production';process.env.PUBLIC_URL='/3dviewer/';process.env.APP_CONFIG='config/standalone.js';process.chdir(path.join(stage,'platform/app'));
const webpack=require(path.join(root,'node_modules/webpack'));
const config=require(path.join(stage,'platform/app/.webpack/webpack.pwa.js'))({}, {mode:'production'});
config.resolve.alias={ '@ohif/ui-next/components':path.join(stage,'platform/ui-next/src/components'), ...config.resolve.alias };
// Resolve every workspace package to the reviewed web-only checkout, even though
// installed dependencies are shared with the development checkout.
for(const group of ['platform','extensions','modes'])for(const name of fs.readdirSync(path.join(stage,group))){
 const folder=path.join(stage,group,name),pkg=path.join(folder,'package.json');
 if(fs.existsSync(pkg)){const json=JSON.parse(fs.readFileSync(pkg,'utf8'));if(json.name)config.resolve.alias[json.name]=folder;}
}
config.devtool=false;
webpack(config,(error,stats)=>{if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;}else console.log(stats.toString({all:false,hash:true,timings:true,errors:true,warnings:true}));});
