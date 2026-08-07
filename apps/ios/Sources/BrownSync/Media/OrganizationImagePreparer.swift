import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct PrivacyStrippedOrganizationImage: Equatable, Sendable {
    let bytes: Data
    let contentType: OrganizationMediaContentType
}

protocol OrganizationImagePreparing: Sendable {
    func prepare(
        transferableData: Data,
        kind: OrganizationMediaKind
    ) async throws -> PrivacyStrippedOrganizationImage
}

struct ImageIOOrganizationImagePreparer:
    OrganizationImagePreparing,
    Sendable
{
    func prepare(
        transferableData: Data,
        kind: OrganizationMediaKind
    ) async throws -> PrivacyStrippedOrganizationImage {
        try Task.checkCancellation()
        guard
            !transferableData.isEmpty,
            transferableData.count <= 8_388_608,
            let source = CGImageSourceCreateWithData(
                transferableData as CFData,
                [
                    kCGImageSourceShouldCache: false,
                    kCGImageSourceShouldCacheImmediately: false,
                ] as CFDictionary
            ),
            CGImageSourceGetCount(source) == 1,
            let sourceProperties =
                CGImageSourceCopyPropertiesAtIndex(
                    source,
                    0,
                    nil
                ) as? [CFString: Any],
            let sourceWidth =
                sourceProperties[kCGImagePropertyPixelWidth] as? Int,
            let sourceHeight =
                sourceProperties[kCGImagePropertyPixelHeight] as? Int
        else {
            throw OrganizationAssetError.invalidSelection
        }
        guard
            (1...12_000).contains(sourceWidth),
            (1...12_000).contains(sourceHeight),
            sourceWidth * sourceHeight <= 40_000_000
        else {
            throw OrganizationAssetError.invalidMedia
        }

        let maximum = maximumSize(for: kind)
        guard
            let decoded = CGImageSourceCreateThumbnailAtIndex(
                source,
                0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize:
                        max(maximum.width, maximum.height),
                ] as CFDictionary
            )
        else {
            throw OrganizationAssetError.invalidSelection
        }

        let image = try resizedImage(decoded, for: kind)
        let sourceType = CGImageSourceGetType(source)
            .map { String($0) }
        let contentType: OrganizationMediaContentType =
            sourceType == UTType.png.identifier && hasAlpha(image)
            ? .png
            : .jpeg
        let destinationType: CFString =
            contentType == .png
            ? UTType.png.identifier as CFString
            : UTType.jpeg.identifier as CFString
        let output = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(
                output,
                destinationType,
                1,
                nil
            )
        else {
            throw OrganizationAssetError.invalidMedia
        }

        let properties: [CFString: Any]
        switch contentType {
        case .jpeg:
            properties = [
                kCGImageDestinationLossyCompressionQuality: 0.82
            ]
        case .png:
            properties = [:]
        case .webP:
            throw OrganizationAssetError.unsupportedMedia
        }
        CGImageDestinationAddImage(
            destination,
            image,
            properties as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else {
            throw OrganizationAssetError.invalidMedia
        }

        try Task.checkCancellation()
        let bytes = output as Data
        guard
            !bytes.isEmpty,
            bytes.count <= 8_388_608,
            let sanitizedSource = CGImageSourceCreateWithData(
                bytes as CFData,
                nil
            ),
            let sanitizedProperties =
                CGImageSourceCopyPropertiesAtIndex(
                    sanitizedSource,
                    0,
                    nil
                ) as? [CFString: Any],
            sanitizedProperties[kCGImagePropertyExifDictionary] == nil,
            sanitizedProperties[kCGImagePropertyGPSDictionary] == nil,
            sanitizedProperties[kCGImagePropertyTIFFDictionary] == nil
        else {
            throw OrganizationAssetError.invalidMedia
        }

        return PrivacyStrippedOrganizationImage(
            bytes: bytes,
            contentType: contentType
        )
    }

    private func resizedImage(
        _ image: CGImage,
        for kind: OrganizationMediaKind
    ) throws -> CGImage {
        let maximum = maximumSize(for: kind)
        let scale = min(
            1,
            min(
                Double(maximum.width) / Double(image.width),
                Double(maximum.height) / Double(image.height)
            )
        )
        let width = max(1, Int((Double(image.width) * scale).rounded()))
        let height = max(
            1,
            Int((Double(image.height) * scale).rounded())
        )
        let colorSpace =
            CGColorSpace(name: CGColorSpace.sRGB)
            ?? CGColorSpaceCreateDeviceRGB()
        guard
            let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo:
                    CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else {
            throw OrganizationAssetError.invalidMedia
        }
        context.interpolationQuality = .high
        context.draw(
            image,
            in: CGRect(x: 0, y: 0, width: width, height: height)
        )
        guard let resized = context.makeImage() else {
            throw OrganizationAssetError.invalidMedia
        }
        return resized
    }

    private func maximumSize(
        for kind: OrganizationMediaKind
    ) -> (width: Int, height: Int) {
        switch kind {
        case .avatar:
            return (1_024, 1_024)
        case .banner:
            return (1_920, 1_080)
        case .gallery:
            return (1_920, 1_920)
        }
    }

    private func hasAlpha(_ image: CGImage) -> Bool {
        switch image.alphaInfo {
        case .first, .last, .premultipliedFirst, .premultipliedLast:
            return true
        case .alphaOnly, .none, .noneSkipFirst, .noneSkipLast:
            return false
        @unknown default:
            return false
        }
    }
}
