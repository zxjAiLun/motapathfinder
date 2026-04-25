main.floors.C21=
{
    "floorId": "C21",
    "title": "死火山",
    "name": "死火山",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2,
    "defaultGround": 819,
    "bgm": "3.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "0,10": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n3黄钥匙，2蓝钥匙。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            0,
                            255,
                            125,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "item:I582",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "hide",
                                "remove": true
                            }
                        ]
                    },
                    {
                        "text": "取消",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "1,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [157,157,157,157,157,157,157,157,157,157,157,157,157],
    [157, 87,157, 28,157, 27,157, 21,157, 27,157, 32,157],
    [157,  0,326,  0,157,255, 22,255,157,254,157, 81,157],
    [157, 27,157, 34, 86,  0,325,  0, 82, 31,  0, 27,157],
    [157, 82,157,157,157,157,157,254,157,157,280,157,157],
    [157,  0,157, 28,157, 29,  0, 31,325, 81,  0, 31,157],
    [157,253,157,253,157,157,252,157,157,157, 82,157,157],
    [157, 21,254, 22, 82, 28,  0, 21,157,157,  0, 27,157],
    [157,157,157, 81,157,157,157, 81,157,157,157,253,157],
    [157,  0,157,  0, 32,157,  0,252,  0,157, 31,  0,157],
    [ 89,  0,157,251,157,157,325,157, 82,157,251,157,157],
    [157, 30,251,  0, 21, 81,  0,252,  0, 32,  0, 21,157],
    [157,157,157,157,157,157,157,157,157,157,157,157,157]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}