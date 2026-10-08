import {exportDataset} from '../src/dataset.js';
const destination=process.argv[2];
const result=await exportDataset(destination?{destination}:{});
console.log('Dataset exporté : '+result.count+' exemples humains validés dans '+result.destination);
