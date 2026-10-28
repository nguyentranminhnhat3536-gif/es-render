// điểm vào IIFE: window.ES3D = { mount, version, versions, presets }
import { mount, version, presets } from './index.jsx';
import { REVISION } from 'three';
import VERSIONS from '../VERSIONS.gen.json';
window.ES3D = Object.freeze({ mount, version, presets, three: REVISION, versions: VERSIONS });
