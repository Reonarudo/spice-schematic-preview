# Relative includes

Included files are read through Obsidian's vault, relative to this note's folder. `../` may
climb to another folder of the vault, but never above it.

## Up one folder, still inside the vault

```spice {caption="X1 comes from ../models/opamp.inc"}
.include ../models/opamp.inc
V1 in 0 SIN(0 1 1k)
R1 in inv 10k
R2 inv out 47k
X1 0 inv out opamp
```

## Above the vault: refused, whatever is there

```spice
.include ../../outside.inc
R1 a 0 1k
```
