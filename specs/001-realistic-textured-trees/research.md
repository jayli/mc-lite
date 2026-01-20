# Research: Realistic Textured Trees

**Date**: 2026-01-20
**Input**: `plan.md` section "Technical Context"

## Objective

This research aims to resolve the `NEEDS CLARIFICATION` item in the implementation plan: "Which specific texture files from `assets/minecraft` should be used for the trunk and leaves of the new tree model?"

## Investigation

An exploration of the `assets/minecraft` directory was conducted using the `ls -R` command. The most relevant subdirectory found was `assets/minecraft/textures/block`, which contains several `.png` image files suitable for texturing.

### Potential Texture Files

Based on the file names, the following candidates were identified:

- **For Leaves**:
  - `acacia_leaves_gs_branch.png`
  - `jungle_leaves_gs_branch.png`
  - `oak_leaves_branch.png`
  - `oak_leaves_branch_medium.png` (Selected)
  - `sakura.png`
  - `pine.png`

- **For Trunk/Branches**:
  - `azalea_branch.png` (Selected)
  - `sakura_branch.png`

## Decision & Rationale

Without the ability to visually inspect the textures, the decisions are based on the most descriptive and common file names.

- **Decision 1: Use `oak_leaves_branch_medium.png` for leaves.**
  - **Rationale**: "Oak" is a common and representative tree type in Minecraft. The "medium" suffix suggests a good level of detail suitable for the new model, and "branch" implies the texture includes not just leaves but also parts of the branch structure, which is ideal for creating a more realistic look.

- **Decision 2: Use `azalea_branch.png` for the trunk.**
  - **Rationale**: This was the most suitable candidate found for a tree trunk or main branch texture. While not explicitly named "trunk", "branch" is the closest available descriptor. This texture will be used to create the central pillar and any larger branches of the new tree model.

## Resolved Clarification

The `NEEDS CLARIFICATION` item is now resolved. The implementation will proceed using the following texture files:
- **Leaves Texture**: `assets/minecraft/textures/block/oak_leaves_branch_medium.png`
- **Trunk Texture**: `assets/minecraft/textures/block/azalea_branch.png`
