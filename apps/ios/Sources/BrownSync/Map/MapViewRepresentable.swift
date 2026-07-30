import CoreLocation
import MapLibre
import SwiftUI

struct MapViewRepresentable: UIViewRepresentable {
    @Binding var status: MapLoadStatus

    func makeCoordinator() -> Coordinator {
        Coordinator(status: $status)
    }

    func makeUIView(context: Context) -> MLNMapView {
        do {
            let bundle = Bundle.main
            guard let styleURL = bundle.url(forResource: "style", withExtension: "json") else {
                throw StyleLoaderError.missingResource("style.json")
            }
            guard let archiveURL = bundle.url(
                forResource: "providence",
                withExtension: "pmtiles"
            ) else {
                throw StyleLoaderError.missingResource("providence.pmtiles")
            }
            guard let resourcesURL = bundle.resourceURL else {
                throw StyleLoaderError.missingResource("bundle resources")
            }
            let glyphsURL = resourcesURL.appendingPathComponent(
                "glyphs",
                isDirectory: true
            )

            _ = try CampusBuildings.decode(
                try bundledData(named: "campus-buildings", extension: "geojson")
            )
            let camera = try StyleLoader.camera(
                from: try Data(contentsOf: styleURL)
            )
            let preparedStyleURL = try StyleLoader.prepare(
                styleURL: styleURL,
                archiveURL: archiveURL,
                glyphsDirectoryURL: glyphsURL
            )
            let mapView = MLNMapView(
                frame: .zero,
                styleURL: preparedStyleURL
            )
            configure(mapView, coordinator: context.coordinator)
            apply(camera, to: mapView)
            return mapView
        } catch {
            let mapView = MLNMapView(frame: .zero, styleURL: nil)
            configure(mapView, coordinator: context.coordinator)
            context.coordinator.fail(error)
            return mapView
        }
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {}

    private func bundledData(named name: String, extension fileExtension: String) throws -> Data {
        guard let url = Bundle.main.url(
            forResource: name,
            withExtension: fileExtension
        ) else {
            throw StyleLoaderError.missingResource("\(name).\(fileExtension)")
        }
        return try Data(contentsOf: url)
    }

    private func configure(
        _ mapView: MLNMapView,
        coordinator: Coordinator
    ) {
        mapView.delegate = coordinator
    }

    private func apply(_ camera: StyleCamera, to mapView: MLNMapView) {
        let center = CLLocationCoordinate2D(
            latitude: camera.latitude,
            longitude: camera.longitude
        )
        let normalizedBearing = camera.bearing
            .truncatingRemainder(dividingBy: 360) + (camera.bearing < 0 ? 360 : 0)
        mapView.setCenter(
            center,
            zoomLevel: camera.zoom,
            direction: normalizedBearing,
            animated: false
        )
        let pitchedCamera = mapView.camera
        pitchedCamera.pitch = camera.pitch
        mapView.setCamera(pitchedCamera, animated: false)
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        @Binding private var status: MapLoadStatus

        init(status: Binding<MapLoadStatus>) {
            _status = status
        }

        func mapViewDidFinishRenderingMap(
            _ mapView: MLNMapView,
            fullyRendered: Bool
        ) {
            guard fullyRendered else { return }
            status = status.acceptingFullyRendered()
            guard status == .ready else { return }
            print("BROWNSYNC_MAP_READY fullyRendered=true")
        }

        func mapViewDidFailLoadingMap(
            _ mapView: MLNMapView,
            withError error: Error
        ) {
            fail(error)
        }

        func fail(_ error: Error) {
            let message = error.localizedDescription
            status = .failed(message)
            print("BROWNSYNC_MAP_FAILED \(message)")
        }
    }
}
