import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import { COLORS } from './theme';

// Temporary canvas setup
const canvas = document.getElementById('stage') as HTMLCanvasElement;
if (canvas) {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.fillStyle = '#' + COLORS.void.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

console.log('boot ok');
