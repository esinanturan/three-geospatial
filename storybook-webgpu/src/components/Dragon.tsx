import type { ComponentProps, FC } from 'react'
import type { MeshPhysicalMaterial } from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'

import { useGLTF } from '../hooks/useGLTF'

export interface DragonProps extends ComponentProps<'mesh'> {}

export const Dragon: FC<DragonProps> = props => {
  const gltf = useGLTF('/public/dragon_attenuation.glb')
  const mesh = gltf.meshes.Dragon

  const userData: {
    initialized?: boolean
  } = gltf.userData

  if (userData.initialized !== true) {
    userData.initialized = true

    const material = new MeshPhysicalNodeMaterial(
      mesh.material as MeshPhysicalMaterial
    )
    mesh.material = material
  }

  return <primitive object={mesh} {...props} />
}
