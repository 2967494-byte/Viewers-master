import { getOrbitalDecodeBudget } from './orbitalDecodeBudget';

it('uses one decoder on low-memory or low-thread devices, leaving bounded download look-ahead', () => {
  expect(getOrbitalDecodeBudget({deviceMemory:4,hardwareConcurrency:16},3)).toEqual({decoders:1,pipelines:2,constrained:true});
  expect(getOrbitalDecodeBudget({deviceMemory:8,hardwareConcurrency:2},3).decoders).toBe(1);
  expect(getOrbitalDecodeBudget({hardwareConcurrency:4}).decoders).toBe(1);
});
it('caps ordinary and unknown devices at two workers and honors a lower application cap', () => {
  expect(getOrbitalDecodeBudget({deviceMemory:8,hardwareConcurrency:16},3)).toEqual({decoders:2,pipelines:4,constrained:false});
  expect(getOrbitalDecodeBudget({},3).decoders).toBe(2);
  expect(getOrbitalDecodeBudget({hardwareConcurrency:16},1).decoders).toBe(1);
  expect(getOrbitalDecodeBudget({hardwareConcurrency:1},3).decoders).toBe(1);
  expect(getOrbitalDecodeBudget({hardwareConcurrency:NaN},NaN).decoders).toBe(2);
});
