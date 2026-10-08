import { exportDataset } from '../src/dataset.js';
const destination=process.argv[2]||'dataset.jsonl';
const {count}=await exportDataset({destination});
console.log('Dataset exporté : '+count+' exemples humains validés dans '+destination);
