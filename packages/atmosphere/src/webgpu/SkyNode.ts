import { hash } from 'three/src/nodes/core/NodeUtils.js'
import {
  Fn,
  mix,
  nodeProxy,
  positionGeometry,
  screenUV,
  uv,
  vec2,
  vec3,
  vec4
} from 'three/tsl'
import { TempNode, type NodeBuilder } from 'three/webgpu'

import {
  equirectToDirectionWorld,
  inverseProjectionMatrix,
  inverseViewMatrix,
  type Node
} from '@takram/three-geospatial/webgpu'

import { getAtmosphereContext } from './AtmosphereContext'
import { MoonNode } from './MoonNode'
import { getIndirectLuminance } from './runtime'
import { StarsNode } from './StarsNode'
import { SunNode } from './SunNode'

const QUAD = 'QUAD'
const EQUIRECTANGULAR = 'EQUIRECTANGULAR'
const SCREEN = 'SCREEN'

type SkyNodeScope = typeof QUAD | typeof EQUIRECTANGULAR | typeof SCREEN

export class SkyNode extends TempNode {
  static override get type(): string {
    return 'SkyNode'
  }

  private readonly scope: SkyNodeScope = QUAD

  shadowLengthNode?: Node<'vec2'> | null

  sunNode: SunNode
  moonNode: MoonNode
  starsNode: StarsNode

  showSun = true
  showMoon = true
  showStars = true
  moonScattering = false
  useContextCamera = true

  constructor(scope: SkyNodeScope, shadowLengthNode?: Node<'vec2'> | null) {
    super('vec3')
    this.scope = scope
    this.shadowLengthNode = shadowLengthNode
    this.sunNode = new SunNode()
    this.moonNode = new MoonNode()
    this.starsNode = new StarsNode()
  }

  override customCacheKey(): number {
    return hash(
      +this.showSun,
      +this.showMoon,
      +this.showStars,
      +this.moonScattering,
      +this.useContextCamera
    )
  }

  override setup(builder: NodeBuilder): unknown {
    const atmosphereContext = getAtmosphereContext(builder)

    const {
      matrixWorldToECEF,
      sunDirectionECEF,
      moonDirectionECEF,
      cameraPositionUnit,
      altitudeCorrectionUnit
    } = atmosphereContext

    const getRayDirectionECEF = Fn((): Node<'vec3'> => {
      let directionWorld
      let vertexStage = false
      const camera = this.useContextCamera ? atmosphereContext.camera : null
      switch (this.scope) {
        case QUAD: {
          const positionView = inverseProjectionMatrix(camera).mul(
            vec4(positionGeometry, 1)
          ).xyz
          directionWorld = inverseViewMatrix(camera).mul(
            vec4(positionView, 0)
          ).xyz // Normalize later
          vertexStage = true
          break
        }
        case EQUIRECTANGULAR: {
          directionWorld = equirectToDirectionWorld(uv())
          vertexStage = true
          break
        }
        case SCREEN: {
          // positionWorld.sub(cameraPositionWorld(camera)) could produce the
          // same result, but it suffers from precision issues when it's located
          // far from the world origin.
          const positionView = inverseProjectionMatrix(camera).mul(
            vec4(screenUV.flipY().mul(2).sub(1), 1, 1)
          ).xyz
          directionWorld = inverseViewMatrix(camera).mul(
            vec4(positionView, 0)
          ).xyz // Normalize later
        }
      }
      const result = matrixWorldToECEF.mul(vec4(directionWorld, 0)).xyz
      return (vertexStage ? result.toVertexStage() : result).normalize()
    })

    return Fn(() => {
      const rayDirectionECEF = getRayDirectionECEF().toConst()

      const solarLuminanceTransfer = getIndirectLuminance(
        cameraPositionUnit.add(altitudeCorrectionUnit),
        rayDirectionECEF,
        this.shadowLengthNode ?? vec2(0),
        sunDirectionECEF
      ).toConst()
      const transmittance = solarLuminanceTransfer.get('transmittance')
      let inscattering = solarLuminanceTransfer.get('luminance')

      if (this.moonScattering) {
        const lunarLuminanceTransfer = getIndirectLuminance(
          cameraPositionUnit.add(altitudeCorrectionUnit),
          rayDirectionECEF,
          this.shadowLengthNode ?? vec2(0),
          moonDirectionECEF
        )

        // TODO: Consider moon phase
        inscattering = inscattering.add(
          lunarLuminanceTransfer.get('luminance').mul(2.5e-6)
        )
      }

      const luminance = vec3(0).toVar()

      if (this.showStars) {
        luminance.addAssign(this.starsNode)
      }

      if (this.showSun) {
        const { sunNode } = this
        sunNode.rayDirectionECEF = rayDirectionECEF
        luminance.assign(mix(luminance, sunNode.rgb, sunNode.a))
      }

      if (this.showMoon) {
        const { moonNode } = this
        moonNode.rayDirectionECEF = rayDirectionECEF
        luminance.assign(mix(luminance, moonNode.rgb, moonNode.a))
      }

      return luminance.mul(transmittance).add(inscattering)
    })()
  }
}

export const sky = /*#__PURE__*/ nodeProxy(SkyNode, QUAD)
export const skyBackground = /*#__PURE__*/ nodeProxy(SkyNode, EQUIRECTANGULAR)
export const skyBackdrop = /*#__PURE__*/ nodeProxy(SkyNode, SCREEN)
