# VictoriaTracker — Claude Code Guidelines

## Git Workflow

All changes must use feature branches. Never commit directly to `main`.

### Start of every session
```powershell
git checkout main
git pull
git checkout -b feature/<short-description>
```

### During work
Commit after each small working change:
```powershell
git add .
git commit -m "description of what changed"
git push origin feature/<short-description>
```

### When the change is tested and working
```powershell
git checkout main
git merge feature/<short-description>
git push
```

### Rolling back if something breaks
- Switch back to main instantly: `git checkout main`
- Undo last commit (keep history): `git revert HEAD`
- Nuke last commit entirely: `git reset --hard HEAD~1`
