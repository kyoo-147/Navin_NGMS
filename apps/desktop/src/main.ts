import './styles.css'
import { bootstrapShell } from './shell/app-shell'

const root = document.getElementById('navin-root')
if (root === null) {
  throw new Error('Navin shell mount point #navin-root is missing')
}

void bootstrapShell(root)
